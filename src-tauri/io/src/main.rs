// stagelight-io: StageLight's native helper for the sound and MIDI modules (docs/MIDI-AND-SOUND.md). The engine starts
// it only while a module is on and speaks newline-delimited JSON over stdin/stdout:
//   in:  devices · audio.open {device, triggers:[{id, channel, band, threshold, gapMs, mode?, attackMs?, releaseMs?}]} · audio.close · audio.meter {on}
//        midi.virtual {name|null} · midi.open {id, input, output} · midi.close {id} · midi.send {port, bytes} · quit
//   out: devices {audio:[{name, inputs}], midiIn, midiOut} · audio {ok, device, channels, rate | error} · hit {id, level}
//        level {levels:{id: dBFS}} (follow-mode triggers, ~30 Hz)
//        meter {input: dBFS, levels:{id: dBFS}} (~15 Hz while an input is open) · midi {port, bytes} · error {message}
// Audio runs in CoreAudio's callback; hits are sent the moment they are detected.
mod detect;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use detect::{Band, Detector};
use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

struct Shared { detectors: Vec<Detector>, meter: bool, since_meter: usize, since_level: usize, rate: f32, input: f32 }

struct Audio { device: String, stream: cpal::Stream, shared: Arc<Mutex<Shared>>, channels: usize }

fn send(tx: &Sender<String>, v: Value) { let _ = tx.send(v.to_string()); }

// "System default input" follows the Mac's Sound settings (the laptop mic, or whatever is chosen there).
const DEFAULT_INPUT: &str = "System default input";

fn devices() -> Value {
    let host = cpal::default_host();
    let default = host.default_input_device().and_then(|d| { let name = d.name().ok()?; let inputs = d.supported_input_configs().ok()?.map(|c| c.channels()).max().unwrap_or(0); Some(json!({"name": DEFAULT_INPUT, "inputs": inputs, "device": name})) });
    let mut audio: Vec<Value> = default.into_iter().collect();
    audio.extend(host.input_devices().map(|list| list.filter_map(|d| {
        let name = d.name().ok()?;
        let inputs = d.supported_input_configs().ok()?.map(|c| c.channels()).max().unwrap_or(0);
        if inputs == 0 { return None; }
        Some(json!({"name": name, "inputs": inputs}))
    }).collect::<Vec<_>>()).unwrap_or_default());
    let ins = MidiInput::new("StageLight scan").map(|m| m.ports().iter().filter_map(|p| m.port_name(p).ok()).collect::<Vec<_>>()).unwrap_or_default();
    let outs = MidiOutput::new("StageLight scan").map(|m| m.ports().iter().filter_map(|p| m.port_name(p).ok()).collect::<Vec<_>>()).unwrap_or_default();
    json!({"ev": "devices", "audio": audio, "midiIn": ins, "midiOut": outs})
}

fn detectors(triggers: &Value, rate: f32) -> Vec<Detector> {
    triggers.as_array().map(|list| list.iter().filter_map(|t| {
        let id = t["id"].as_str()?;
        let channel = t["channel"].as_u64()? as usize;
        let d = Detector::new(id, channel, Band::parse(t["band"].as_str().unwrap_or("kick")), t["threshold"].as_f64().unwrap_or(-30.0) as f32, t["gapMs"].as_u64().unwrap_or(90) as u32, rate);
        Some(if t["mode"].as_str() == Some("follow") { d.follow(t["attackMs"].as_f64().unwrap_or(30.0) as f32, t["releaseMs"].as_f64().unwrap_or(300.0) as f32) } else { d })
    }).collect()).unwrap_or_default()
}

// Feed one interleaved block to every detector; send hits now and meter levels every 50 ms while metering.
fn process(shared: &Arc<Mutex<Shared>>, tx: &Sender<String>, data: &[f32], channels: usize) {
    let Ok(mut s) = shared.try_lock() else { return };
    let frames = data.len() / channels.max(1);
    // The loudest sample on any channel, for the input meter that shows audio is arriving.
    let block_peak = data.iter().fold(0f32, |m, x| m.max(x.abs()));
    if block_peak > s.input { s.input = block_peak; }
    for d in s.detectors.iter_mut() {
        let ch = d.channel - 1;
        if ch >= channels { continue; }
        for f in 0..frames {
            if d.process(data[f * channels + ch]) { send(tx, json!({"ev": "hit", "id": d.id, "level": (d.level_db() * 10.0).round() / 10.0})); }
        }
    }
    // Follow-mode levels go out about 30 times a second, like the engine's own frames.
    s.since_level += frames;
    if s.since_level as f32 >= s.rate / 30.0 {
        s.since_level = 0;
        let levels: serde_json::Map<String, Value> = s.detectors.iter().filter(|d| d.follows()).map(|d| (d.id.clone(), json!((d.follow_db() * 10.0).round() / 10.0))).collect();
        if !levels.is_empty() { send(tx, json!({"ev": "level", "levels": levels})); }
    }
    s.since_meter += frames;
    // Meter: the whole input always (about 15 times a second while the input is open), each trigger too.
    if s.since_meter as f32 >= s.rate / 15.0 {
        s.since_meter = 0;
        let input = ((20.0 * (s.input + 1e-9).log10()).max(-90.0) * 10.0).round() / 10.0;
        s.input = 0.0;
        let levels: serde_json::Map<String, Value> = s.detectors.iter_mut().map(|d| (d.id.clone(), json!((d.take_peak_db() * 10.0).round() / 10.0))).collect();
        send(tx, json!({"ev": "meter", "input": input, "levels": levels}));
    }
}

fn build<T>(device: &cpal::Device, config: &cpal::StreamConfig, shared: Arc<Mutex<Shared>>, tx: Sender<String>) -> Result<cpal::Stream, String>
where T: cpal::SizedSample, f32: cpal::FromSample<T> {
    let channels = config.channels as usize;
    let mut buf: Vec<f32> = Vec::new();
    let err_tx = tx.clone();
    device.build_input_stream(config, move |data: &[T], _: &cpal::InputCallbackInfo| {
        buf.clear();
        buf.extend(data.iter().map(|s| <f32 as cpal::FromSample<T>>::from_sample_(*s)));
        process(&shared, &tx, &buf, channels);
    }, move |e| send(&err_tx, json!({"ev": "error", "message": format!("Audio input: {e}")})), None).map_err(|e| e.to_string())
}

fn open_audio(name: &str, triggers: &Value, tx: &Sender<String>) -> Result<Audio, String> {
    let host = cpal::default_host();
    let device = if name == DEFAULT_INPUT { host.default_input_device().ok_or("This Mac has no input device")? }
        else { host.input_devices().map_err(|e| e.to_string())?.find(|d| d.name().map(|n| n == name).unwrap_or(false)).ok_or(format!("“{name}” is not connected"))? };
    // Every channel the device has, at 48 kHz when it can (Dante Virtual Soundcard runs at the network's rate).
    let range = device.supported_input_configs().map_err(|e| e.to_string())?.max_by_key(|c| c.channels()).ok_or("The device has no inputs")?;
    let rate = if range.min_sample_rate().0 <= 48000 && range.max_sample_rate().0 >= 48000 { cpal::SampleRate(48000) } else { range.max_sample_rate() };
    let supported = range.with_sample_rate(rate);
    let format = supported.sample_format();
    let mut config: cpal::StreamConfig = supported.into();
    config.buffer_size = cpal::BufferSize::Fixed(128);
    let shared = Arc::new(Mutex::new(Shared { detectors: detectors(triggers, rate.0 as f32), meter: false, since_meter: 0, since_level: 0, rate: rate.0 as f32, input: 0.0 }));
    let make = |config: &cpal::StreamConfig| match format {
        cpal::SampleFormat::F32 => build::<f32>(&device, config, shared.clone(), tx.clone()),
        cpal::SampleFormat::I16 => build::<i16>(&device, config, shared.clone(), tx.clone()),
        cpal::SampleFormat::I32 => build::<i32>(&device, config, shared.clone(), tx.clone()),
        cpal::SampleFormat::U16 => build::<u16>(&device, config, shared.clone(), tx.clone()),
        other => Err(format!("Unsupported sample format {other:?}")),
    };
    // Some devices refuse a fixed 128-frame buffer; fall back to the device's own size.
    let stream = make(&config).or_else(|_| { config.buffer_size = cpal::BufferSize::Default; make(&config) })?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(Audio { device: name.to_string(), stream, shared, channels: config.channels as usize })
}

fn find_port<T: midir::MidiIO>(io: &T, name: &str) -> Option<T::Port> { io.ports().into_iter().find(|p| io.port_name(p).map(|n| n == name).unwrap_or(false)) }

fn main() {
    let (tx, rx) = channel::<String>();
    std::thread::spawn(move || { let out = std::io::stdout(); for line in rx { let mut o = out.lock(); let _ = writeln!(o, "{line}"); let _ = o.flush(); } });
    // Hot-plug: report the device list again whenever it changes (an APC40 plugged in, Dante starting).
    { let tx = tx.clone(); std::thread::spawn(move || { let mut last = devices().to_string(); loop { std::thread::sleep(Duration::from_secs(2)); let d = devices().to_string(); if d != last { let _ = tx.send(d.clone()); last = d; } } }); }

    let mut audio: Option<Audio> = None;
    let mut virtual_out: Option<MidiOutputConnection> = None;
    let mut inputs: HashMap<String, MidiInputConnection<()>> = HashMap::new();
    let mut outputs: HashMap<String, MidiOutputConnection> = HashMap::new();
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(m) = serde_json::from_str::<Value>(&line) else { continue };
        match m["op"].as_str().unwrap_or("") {
            "devices" => send(&tx, devices()),
            "audio.open" => {
                let name = m["device"].as_str().unwrap_or("");
                if let Some(a) = audio.as_ref().filter(|a| a.device == name) {
                    let mut s = a.shared.lock().unwrap();
                    let rate = s.rate;
                    s.detectors = detectors(&m["triggers"], rate);
                    send(&tx, json!({"ev": "audio", "ok": true, "device": name, "channels": a.channels, "rate": rate}));
                } else {
                    audio = None;
                    match open_audio(name, &m["triggers"], &tx) {
                        Ok(a) => { let rate = a.shared.lock().unwrap().rate; send(&tx, json!({"ev": "audio", "ok": true, "device": name, "channels": a.channels, "rate": rate})); audio = Some(a); }
                        Err(e) => send(&tx, json!({"ev": "audio", "ok": false, "device": name, "error": e})),
                    }
                }
            }
            "audio.close" => { if let Some(a) = audio.take() { let _ = a.stream.pause(); } }
            "audio.meter" => { if let Some(a) = &audio { a.shared.lock().unwrap().meter = m["on"].as_bool().unwrap_or(false); } }
            "midi.virtual" => {
                virtual_out = None;
                if let Some(name) = m["name"].as_str() {
                    #[cfg(unix)]
                    {
                        use midir::os::unix::VirtualOutput;
                        match MidiOutput::new("StageLight").map_err(|e| e.to_string()).and_then(|o| o.create_virtual(name).map_err(|e| e.to_string())) {
                            Ok(c) => virtual_out = Some(c),
                            Err(e) => send(&tx, json!({"ev": "error", "message": format!("Virtual MIDI port: {e}")})),
                        }
                    }
                    #[cfg(not(unix))]
                    send(&tx, json!({"ev": "error", "message": format!("A virtual MIDI port “{name}” needs macOS")}));
                }
            }
            "midi.open" => {
                let id = m["id"].as_str().unwrap_or("controller").to_string();
                inputs.remove(&id); outputs.remove(&id);
                if let Some(name) = m["input"].as_str() {
                    if let Ok(mut mi) = MidiInput::new("StageLight") {
                        mi.ignore(Ignore::None);
                        if let Some(port) = find_port(&mi, name) {
                            let (tx2, id2) = (tx.clone(), id.clone());
                            match mi.connect(&port, "StageLight in", move |_, bytes, _| send(&tx2, json!({"ev": "midi", "port": id2, "bytes": bytes})), ()) {
                                Ok(c) => { inputs.insert(id.clone(), c); }
                                Err(e) => send(&tx, json!({"ev": "error", "message": format!("MIDI in {name}: {e}")})),
                            }
                        }
                    }
                }
                if let Some(name) = m["output"].as_str() {
                    if let Ok(mo) = MidiOutput::new("StageLight") {
                        if let Some(port) = find_port(&mo, name) {
                            match mo.connect(&port, "StageLight out") {
                                Ok(c) => { outputs.insert(id.clone(), c); }
                                Err(e) => send(&tx, json!({"ev": "error", "message": format!("MIDI out {name}: {e}")})),
                            }
                        }
                    }
                }
            }
            "midi.close" => { let id = m["id"].as_str().unwrap_or(""); inputs.remove(id); outputs.remove(id); }
            "midi.send" => {
                let bytes: Vec<u8> = m["bytes"].as_array().map(|a| a.iter().filter_map(|b| b.as_u64().map(|v| v as u8)).collect()).unwrap_or_default();
                let port = m["port"].as_str().unwrap_or("");
                let conn = if port == "virtual" { virtual_out.as_mut() } else { outputs.get_mut(port) };
                if let Some(c) = conn { let _ = c.send(&bytes); }
            }
            "quit" => break,
            _ => {}
        }
    }
}
