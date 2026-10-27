// Fixtures hidden from the 3D visualizer (show.visualizer): they are not drawn at all, so a large rig stays light.
// Preview only: DMX output, cues and look reports are unaffected. Shared by the desk, the pop-out visualizer and the engine.
export function hiddenFixtureIds(show){
 const v=show.visualizer??{},ids=new Set(v.hiddenFixtures??[]);
 for(const g of v.hiddenGroups??[])for(const id of show.groups.find(x=>x.id===g)?.fixtures??[])ids.add(id);
 return ids;
}
export function visibleFixtures(show){const hidden=hiddenFixtureIds(show);return show.fixtures.filter(f=>!hidden.has(f.id))}
