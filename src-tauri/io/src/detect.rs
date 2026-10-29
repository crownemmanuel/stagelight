// Hit detection for one input channel (docs/MIDI-AND-SOUND.md). A band filter keeps the drum's range (kick, snare,
// hat or full) and a peak envelope follows the level. A hit is the envelope rising through the threshold at least `gap`
// after the last hit; the trigger re-arms only once the level has fallen 6 dB below the threshold, like a drum trigger,
// so a held note or a ringing drum is one hit. Runs in the audio callback, so it allocates nothing.

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Band { Kick, Snare, Hat, Full }

impl Band {
    pub fn parse(s: &str) -> Band {
        match s { "snare" => Band::Snare, "hat" => Band::Hat, "full" => Band::Full, _ => Band::Kick }
    }
}

// RBJ biquad, direct form I.
#[derive(Clone, Copy, Debug)]
struct Biquad { b0: f32, b1: f32, b2: f32, a1: f32, a2: f32, x1: f32, x2: f32, y1: f32, y2: f32 }

impl Biquad {
    fn new(kind: char, freq: f32, q: f32, rate: f32) -> Biquad {
        let w = 2.0 * std::f32::consts::PI * freq / rate;
        let (sin, cos) = w.sin_cos();
        let alpha = sin / (2.0 * q);
        let (b0, b1, b2) = if kind == 'l' { ((1.0 - cos) / 2.0, 1.0 - cos, (1.0 - cos) / 2.0) } else { ((1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0) };
        let a0 = 1.0 + alpha;
        Biquad { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -2.0 * cos / a0, a2: (1.0 - alpha) / a0, x1: 0.0, x2: 0.0, y1: 0.0, y2: 0.0 }
    }
    fn run(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1; self.x1 = x; self.y2 = self.y1; self.y1 = y;
        y
    }
}

pub struct Detector {
    pub id: String,
    pub channel: usize,
    threshold: f32,
    gap: u32,
    filters: Vec<Biquad>,
    env: f32,
    release: f32,
    armed: bool,
    since: u32,
    peak: f32,
    // Follow mode: the smoothed level the master rides, with attack and release coefficients per sample.
    follow: Option<(f32, f32)>,
    smooth: f32,
    rate: f32,
}

impl Detector {
    // channel is 1-based, threshold in dBFS, gap in milliseconds.
    pub fn new(id: &str, channel: usize, band: Band, threshold: f32, gap_ms: u32, rate: f32) -> Detector {
        let filters = match band {
            Band::Kick => vec![Biquad::new('l', 150.0, 0.707, rate), Biquad::new('l', 150.0, 0.707, rate)],
            Band::Snare => vec![Biquad::new('h', 200.0, 0.707, rate), Biquad::new('l', 4000.0, 0.707, rate)],
            Band::Hat => vec![Biquad::new('h', 6000.0, 0.707, rate), Biquad::new('h', 6000.0, 0.707, rate)],
            Band::Full => vec![],
        };
        Detector {
            id: id.to_string(), channel, threshold, gap: (gap_ms as f32 * rate / 1000.0) as u32, filters,
            env: 0.0, release: (-1.0 / (0.03 * rate)).exp(), armed: true, since: u32::MAX / 2, peak: 0.0, follow: None, smooth: 0.0, rate,
        }
    }
    // Follow the level instead of detecting hits (docs/MIDI-AND-SOUND.md): attack and release in milliseconds.
    pub fn follow(mut self, attack_ms: f32, release_ms: f32) -> Detector {
        let coef = |ms: f32| 1.0 - (-1.0 / (ms.max(1.0) * self.rate / 1000.0)).exp();
        self.follow = Some((coef(attack_ms), coef(release_ms)));
        self
    }
    pub fn follows(&self) -> bool { self.follow.is_some() }
    // The followed level in dBFS (RMS-like: the smoothed rectified signal).
    pub fn follow_db(&self) -> f32 { (20.0 * (self.smooth + 1e-9).log10()).max(-90.0) }
    // One sample; true when it is a hit (never in follow mode).
    pub fn process(&mut self, x: f32) -> bool {
        let mut y = x;
        for f in self.filters.iter_mut() { y = f.run(y); }
        let a = y.abs();
        if let Some((attack, release)) = self.follow {
            self.smooth += (a - self.smooth) * if a > self.smooth { attack } else { release };
            if a > self.peak { self.peak = a; }
            return false;
        }
        self.env = if a > self.env { a } else { self.env * self.release };
        if self.env > self.peak { self.peak = self.env; }
        self.since = self.since.saturating_add(1);
        let db = 20.0 * (self.env + 1e-9).log10();
        if !self.armed { if db < self.threshold - 6.0 { self.armed = true; } return false; }
        // A rise inside the gap is used up, never fired later in the same drum's decay.
        if db > self.threshold {
            self.armed = false;
            if self.since >= self.gap { self.since = 0; return true; }
        }
        false
    }
    pub fn level_db(&self) -> f32 { 20.0 * (self.env + 1e-9).log10() }
    // Highest level since the last call, for the meter.
    pub fn take_peak_db(&mut self) -> f32 { let p = self.peak; self.peak = 0.0; (20.0 * (p + 1e-9).log10()).max(-90.0) }
}

#[cfg(test)]
mod tests {
    use super::*;
    const RATE: f32 = 48000.0;
    // A kick: a 60 Hz sine that drops in pitch and decays over ~150 ms, at the given peak in dBFS.
    fn kick(peak_db: f32) -> Vec<f32> {
        let amp = 10f32.powf(peak_db / 20.0);
        (0..(0.2 * RATE) as usize).map(|i| { let t = i as f32 / RATE; amp * (-t / 0.05).exp() * (2.0 * std::f32::consts::PI * (60.0 + 80.0 * (-t / 0.01).exp()) * t).sin() }).collect()
    }
    fn silence(seconds: f32) -> Vec<f32> { vec![0.0; (seconds * RATE) as usize] }
    fn hits(d: &mut Detector, signal: &[f32]) -> usize { signal.iter().filter(|&&x| d.process(x)).count() }

    #[test]
    fn a_kick_above_the_threshold_is_one_hit() {
        let mut d = Detector::new("m1", 1, Band::Kick, -30.0, 90, RATE);
        let mut s = silence(0.1); s.extend(kick(-12.0)); s.extend(silence(0.3)); s.extend(kick(-12.0));
        assert_eq!(hits(&mut d, &s), 2);
    }
    #[test]
    fn a_kick_below_the_threshold_is_ignored() {
        let mut d = Detector::new("m1", 1, Band::Kick, -10.0, 90, RATE);
        assert_eq!(hits(&mut d, &kick(-20.0)), 0);
    }
    #[test]
    fn hits_closer_than_the_gap_count_once() {
        let mut d = Detector::new("m1", 1, Band::Full, -40.0, 400, RATE);
        let mut s = kick(-6.0); s.extend(silence(0.15)); s.extend(kick(-6.0));
        assert_eq!(hits(&mut d, &s), 1);
        let mut d = Detector::new("m1", 1, Band::Full, -40.0, 100, RATE);
        assert_eq!(hits(&mut d, &s), 2);
    }
    #[test]
    fn the_kick_band_ignores_a_hi_hat() {
        let hat: Vec<f32> = (0..4800).map(|i| 0.5 * (-(i as f32) / 600.0).exp() * (2.0 * std::f32::consts::PI * 9000.0 * i as f32 / RATE).sin()).collect();
        let mut d = Detector::new("m1", 1, Band::Kick, -30.0, 90, RATE);
        assert_eq!(hits(&mut d, &hat), 0);
        let mut d = Detector::new("m1", 1, Band::Hat, -30.0, 90, RATE);
        assert_eq!(hits(&mut d, &hat), 1);
    }
    #[test]
    fn follow_mode_rises_with_the_sound_and_falls_after_it() {
        let tone: Vec<f32> = (0..(0.5 * RATE) as usize).map(|i| 0.5 * (2.0 * std::f32::consts::PI * 220.0 * i as f32 / RATE).sin()).collect();
        let mut d = Detector::new("m1", 1, Band::Full, -40.0, 90, RATE).follow(20.0, 300.0);
        assert_eq!(hits(&mut d, &tone), 0, "follow mode never fires hits");
        let loud = d.follow_db();
        assert!(loud > -12.0 && loud < -3.0, "a -6 dBFS tone follows at about -10 dBFS, got {loud}");
        for _ in 0..(0.3 * RATE) as usize { d.process(0.0); }
        let after = d.follow_db();
        assert!(after < loud - 6.0 && after > -60.0, "300 ms release: down but not gone, got {after}");
        for _ in 0..(3.0 * RATE) as usize { d.process(0.0); }
        assert!(d.follow_db() < -60.0, "silence falls away");
    }
    #[test]
    fn steady_sound_is_not_a_stream_of_hits() {
        let tone: Vec<f32> = (0..(2.0 * RATE) as usize).map(|i| 0.3 * (2.0 * std::f32::consts::PI * 80.0 * i as f32 / RATE).sin()).collect();
        let mut d = Detector::new("m1", 1, Band::Kick, -40.0, 90, RATE);
        assert!(hits(&mut d, &tone) <= 1);
    }
}
