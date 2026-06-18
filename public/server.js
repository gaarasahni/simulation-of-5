
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const SIM_SECONDS_PER_REAL_SECOND = 36540; // 10h 9m per real second
const STEP_SECONDS = 6 * 60 * 60; // process in 6-hour chunks
const MAX_LOGS = 250;
const GRID_SIZE = 20; // 20x20 huge-world abstraction
const SECTOR_COUNT = GRID_SIZE * GRID_SIZE;
const MAX_WEBHOOK_MESSAGE = 1700;

const speciesTemplates = [
  {
    id: 'goliaths',
    name: 'Granite Colossi',
    alias: 'The Goliaths',
    motto: 'A mountain that learns to walk.',
    color: '#d9a66b',
    style: 'brute_force',
    baseline: { pop: 900, resources: 220, tech: 0.3, aggression: 0.95, logistics: 0.25, stealth: 0.05, resilience: 1.4, adaptation: 0.15, siege: 1.0, growth: 0.35 }
  },
  {
    id: 'vexill',
    name: 'Swarmveil Brood',
    alias: 'The Vexill Hive',
    motto: 'Count the bodies, not the losses.',
    color: '#88d66a',
    style: 'swarm',
    baseline: { pop: 1500, resources: 180, tech: 0.15, aggression: 0.85, logistics: 0.2, stealth: 0.1, resilience: 0.55, adaptation: 0.35, siege: 0.3, growth: 1.45 }
  },
  {
    id: 'othari',
    name: 'Whisper Crown',
    alias: 'The Othari Syndicate',
    motto: 'The strongest blade is the one never seen.',
    color: '#8f7ae5',
    style: 'sabotage',
    baseline: { pop: 420, resources: 260, tech: 1.45, aggression: 0.45, logistics: 1.1, stealth: 1.5, resilience: 0.3, adaptation: 0.6, siege: 0.15, growth: 0.7 }
  },
  {
    id: 'xypherian',
    name: 'Iron Bastions',
    alias: 'The Xypherian Forges',
    motto: 'Walls first. Victory second.',
    color: '#5fb0ff',
    style: 'artillery',
    baseline: { pop: 780, resources: 280, tech: 1.8, aggression: 0.55, logistics: 1.55, stealth: 0.15, resilience: 0.8, adaptation: 0.4, siege: 1.6, growth: 0.95 }
  },
  {
    id: 'chimera',
    name: 'Shifting Chimeras',
    alias: 'The Chimera Strains',
    motto: 'Every wound is a blueprint.',
    color: '#f278d3',
    style: 'adaptive',
    baseline: { pop: 640, resources: 210, tech: 0.85, aggression: 0.72, logistics: 0.55, stealth: 0.4, resilience: 0.75, adaptation: 1.6, siege: 0.65, growth: 1.05 }
  }
];

const matchup = {
  goliaths:   { goliaths: 0.0, vexill: 0.45, othari: 0.85, xypherian: 0.3, chimera: 0.9 },
  vexill:     { goliaths: 0.25, vexill: 0.0, othari: 0.15, xypherian: -0.8, chimera: -0.45 },
  othari:     { goliaths: 0.55, vexill: -0.6, othari: 0.0, xypherian: 0.65, chimera: -0.3 },
  xypherian:  { goliaths: -0.5, vexill: 0.8, othari: -0.65, xypherian: 0.0, chimera: 0.35 },
  chimera:    { goliaths: -0.85, vexill: 0.55, othari: 0.6, xypherian: -0.35, chimera: 0.0 }
};

const strategyNames = {
  goliaths: ['Siege March', 'Titanic Crush', 'Fortress Breach'],
  vexill: ['Brood Flood', 'Nest Bloom', 'Swarm Tide'],
  othari: ['Subversion Net', 'False Flag', 'Mind Spiral'],
  xypherian: ['Artillery Lock', 'Perimeter Forge', 'Kill Zone'],
  chimera: ['Adaptive Drift', 'Counter-Splice', 'Mutation Bloom']
};

const world = {
  startedAt: Date.now(),
  simSeconds: 0,
  running: true,
  pauseCount: 0,
  lastRealTick: Date.now(),
  accumulator: 0,
  currentLeader: null,
  nextLegendAt: 48 * 3600,
  lastLegendSeed: 0,
  sectors: [],
  species: [],
  logs: [],
  webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  lastDiscordSendAt: 0
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function rand(min = 0, max = 1) {
  return min + Math.random() * (max - min);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function round(n) {
  return Math.max(0, Math.round(n));
}

function simCalendar(seconds) {
  const totalHours = Math.floor(seconds / 3600);
  const years = Math.floor(totalHours / (24 * 365));
  const days = Math.floor(totalHours / 24) % 365;
  const hours = totalHours % 24;
  const minutes = Math.floor((seconds % 3600) / 60);
  return { years, days, hours, minutes };
}

function simLabel(seconds) {
  const t = simCalendar(seconds);
  return `Year ${t.years} • Day ${t.days + 1} • ${String(t.hours).padStart(2, '0')}:${String(t.minutes).padStart(2, '0')}`;
}

function makeSector(index) {
  const x = index % GRID_SIZE;
  const y = Math.floor(index / GRID_SIZE);
  const richness = clamp(0.55 + rand(-0.25, 0.5), 0.2, 1.5);
  const fertility = clamp(0.5 + rand(-0.3, 0.45), 0.15, 1.35);
  const elevation = clamp(rand(0, 1), 0, 1);
  const climate = pick(['temperate', 'arid', 'frozen', 'wild', 'volcanic', 'forest']);
  return {
    index,
    x,
    y,
    richness,
    fertility,
    elevation,
    climate,
    owner: null,
    fortification: 0,
    devastation: 0
  };
}

function createSpeciesState(template, seedSector) {
  return {
    id: template.id,
    name: template.name,
    alias: template.alias,
    motto: template.motto,
    color: template.color,
    style: template.style,
    pop: template.baseline.pop,
    resources: template.baseline.resources,
    tech: template.baseline.tech,
    aggression: template.baseline.aggression,
    logistics: template.baseline.logistics,
    stealth: template.baseline.stealth,
    resilience: template.baseline.resilience,
    adaptation: template.baseline.adaptation,
    siege: template.baseline.siege,
    growth: template.baseline.growth,
    morale: 1,
    territory: 1,
    sectors: [seedSector],
    stage: 'primitive',
    stageLevel: 0,
    kills: 0,
    losses: 0,
    totalConquests: 0,
    adaptations: {
      brute: 0,
      swarm: 0,
      arcane: 0,
      artillery: 0,
      sabotage: 0
    },
    status: 'rising',
    strategy: 'awakening',
    lastEvent: 'A small settlement has formed.',
    eliminated: false,
    collapseTicks: 0,
    treatyWith: null
  };
}

function initWorld() {
  world.sectors = Array.from({ length: SECTOR_COUNT }, (_, i) => makeSector(i));
  world.species = [];

  const spawnSectors = new Set();
  while (spawnSectors.size < speciesTemplates.length) {
    spawnSectors.add(Math.floor(Math.random() * SECTOR_COUNT));
  }
  const chosen = [...spawnSectors];

  speciesTemplates.forEach((tpl, idx) => {
    const st = createSpeciesState(tpl, chosen[idx]);
    world.species.push(st);
    world.sectors[chosen[idx]].owner = tpl.id;
  });

  world.simSeconds = 0;
  world.running = true;
  world.pauseCount = 0;
  world.lastRealTick = Date.now();
  world.accumulator = 0;
  world.currentLeader = null;
  world.nextLegendAt = 36 * 3600 + Math.floor(rand(0, 72 * 3600));
  world.lastLegendSeed = 0;
  world.logs = [];
  logEvent('world', 'dawn', {
    headline: 'The simulation begins from the first sparks of civilization.',
    narrative: 'Five primitive powers awaken across a vast, broken continent. Each begins as a fragile ember, but none are meant to stay small.'
  }, true);
}

function getSpecies(id) {
  return world.species.find(s => s.id === id);
}

function aliveSpecies() {
  return world.species.filter(s => !s.eliminated);
}

function aliveCount() {
  return aliveSpecies().length;
}

function territoryCounts() {
  const counts = new Map();
  for (const sp of world.species) counts.set(sp.id, 0);
  for (const sec of world.sectors) {
    if (sec.owner) counts.set(sec.owner, (counts.get(sec.owner) || 0) + 1);
  }
  return counts;
}

function refreshTerritories() {
  const counts = territoryCounts();
  for (const sp of world.species) {
    sp.territory = counts.get(sp.id) || 0;
    sp.sectors = world.sectors.filter(s => s.owner === sp.id).map(s => s.index);
    if (sp.territory === 0 && !sp.eliminated) {
      sp.eliminated = true;
      sp.status = 'extinct';
    }
  }
}

function stageFor(species) {
  const score = species.pop * 0.004 + species.territory * 0.08 + species.tech * 2.2 + species.resources * 0.01;
  if (score < 8) return { level: 0, name: 'spark' };
  if (score < 18) return { level: 1, name: 'tribe' };
  if (score < 35) return { level: 2, name: 'chiefdom' };
  if (score < 60) return { level: 3, name: 'kingdom' };
  if (score < 95) return { level: 4, name: 'empire' };
  return { level: 5, name: 'ascendant' };
}

function powerScore(sp) {
  const base = Math.pow(Math.max(1, sp.pop), 0.78);
  const military = 1 + sp.resilience * 0.25 + sp.tech * 0.45 + sp.siege * 0.25 + sp.morale * 0.15;
  const territory = 1 + Math.sqrt(Math.max(0, sp.territory)) * 0.12;
  return base * military * territory * (0.75 + sp.aggression * 0.45);
}

function controlScore(sp) {
  return powerScore(sp) + sp.tech * 8 + sp.territory * 2.3 + sp.resources * 0.03;
}

function chooseTarget(attacker, speciesList) {
  const candidates = speciesList.filter(s => s.id !== attacker.id && !s.eliminated);
  if (!candidates.length) return null;
  const scored = candidates.map(def => {
    const advantage = matchup[attacker.id]?.[def.id] || 0;
    const vulnerability = 1 + Math.max(0, advantage);
    const threat = controlScore(def) * vulnerability;
    return { def, threat };
  }).sort((a, b) => b.threat - a.threat);
  return scored[0].def;
}

function borderSectors(speciesId) {
  const owned = new Set(world.sectors.filter(s => s.owner === speciesId).map(s => s.index));
  const borders = [];
  for (const sec of world.sectors) {
    if (sec.owner !== speciesId) continue;
    const neighbors = sectorNeighbors(sec.index);
    if (neighbors.some(n => world.sectors[n].owner !== speciesId)) borders.push(sec.index);
  }
  return borders;
}

const neighborCache = new Map();
function sectorNeighbors(index) {
  if (neighborCache.has(index)) return neighborCache.get(index);
  const x = index % GRID_SIZE;
  const y = Math.floor(index / GRID_SIZE);
  const out = [];
  if (x > 0) out.push(index - 1);
  if (x < GRID_SIZE - 1) out.push(index + 1);
  if (y > 0) out.push(index - GRID_SIZE);
  if (y < GRID_SIZE - 1) out.push(index + GRID_SIZE);
  neighborCache.set(index, out);
  return out;
}

function claimSector(speciesId, sectorIndex) {
  const sector = world.sectors[sectorIndex];
  if (!sector) return false;
  const previous = sector.owner;
  sector.owner = speciesId;
  sector.fortification = Math.max(0, sector.fortification - 0.2);
  sector.devastation = clamp(sector.devastation + 0.08, 0, 1);
  return previous !== speciesId;
}

function getBorderCandidate(attackerId, targetId) {
  const border = world.sectors.filter(sec => sec.owner === targetId && sectorNeighbors(sec.index).some(n => world.sectors[n].owner === attackerId));
  if (border.length) return pick(border).index;
  const targetOwned = world.sectors.filter(sec => sec.owner === targetId);
  return targetOwned.length ? pick(targetOwned).index : null;
}

function createNarrative(kind, species, target, amount, bonusText = '') {
  const titleMap = {
    growth: `${species.name} spreads`,
    battle: `${species.name} strikes ${target ? target.name : 'the world'}`,
    sabotage: `${species.name} poisons the balance`,
    evolution: `${species.name} evolves`,
    conquest: `${species.name} takes ground`,
    collapse: `${species.name} falters`,
    legend: `A legend emerges`,
    world: `World event`
  };
  const titles = titleMap[kind] || `${species.name} acts`;
  const scene = [
    `${species.name} is no longer a rumor; it is now a force that bends the frontier.`,
    `${species.alias} moves through the age like a blade drawn across stone.`,
    `${species.name} changes the map in ways that cannot be ignored.`,
    `${species.name} answers pressure with a harsher shape of power.`
  ];
  const line = bonusText || pick(scene);
  return {
    headline: titles,
    narrative: line + (amount ? ` (${amount})` : '')
  };
}

function logEvent(kind, type, payload, immediateDiscord = false) {
  const t = simCalendar(world.simSeconds);
  const event = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    type,
    time: {
      years: t.years,
      days: t.days + 1,
      hours: t.hours,
      minutes: t.minutes
    },
    headline: payload.headline || '',
    narrative: payload.narrative || '',
    speciesId: payload.speciesId || null,
    targetId: payload.targetId || null,
    severity: payload.severity || 'normal',
    simple: payload.simple || '',
    style: payload.style || (Math.random() < 0.55 ? 'simple' : 'narrative')
  };
  world.logs.unshift(event);
  if (world.logs.length > MAX_LOGS) world.logs.length = MAX_LOGS;
  broadcast({ type: 'event', event });
  sendDiscord(event).catch(() => {});
  return event;
}

function broadcast(message) {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch (_) {}
  }
}

function buildDiscordMessage(event) {
  const time = `Y${event.time.years} D${event.time.days} ${String(event.time.hours).padStart(2, '0')}:${String(event.time.minutes).padStart(2, '0')}`;
  const title = event.headline ? `**${event.headline}**` : '**World Event**';
  let body = event.style === 'simple' && event.simple ? event.simple : event.narrative;
  if (!body) body = event.simple || event.narrative || 'An event occurred.';
  const species = event.speciesId ? `\nSpecies: \`${event.speciesId}\`` : '';
  const text = `${title}\n\`${time}\`\n${body}${species}`;
  return text.slice(0, MAX_WEBHOOK_MESSAGE);
}

async function sendDiscord(event) {
  if (!world.webhookUrl) return;
  const now = Date.now();
  // tiny anti-burst guard; still sends all meaningful events, but avoids piles in one millisecond
  if (now - world.lastDiscordSendAt < 250) {
    await new Promise(r => setTimeout(r, 250 - (now - world.lastDiscordSendAt)));
  }
  world.lastDiscordSendAt = Date.now();
  const content = buildDiscordMessage(event);
  try {
    await fetch(world.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
  } catch (_) {}
}

function updateLeader() {
  const alive = aliveSpecies().slice().sort((a, b) => controlScore(b) - controlScore(a));
  if (!alive.length) return;
  const leader = alive[0];
  if (!world.currentLeader || world.currentLeader.id !== leader.id) {
    const previous = world.currentLeader;
    world.currentLeader = { id: leader.id, name: leader.name };
    if (previous && previous.id !== leader.id) {
      logEvent('world', 'leader_change', {
        headline: `${leader.name} overtakes the world lead.`,
        narrative: `Power shifts from ${previous.name} to ${leader.name}. The balance of the continent bends toward a new center of gravity.`,
        simple: `${leader.name} becomes the new leading power.`
      }, true);
    }
  }
}

function maybeLegend() {
  if (world.simSeconds < world.nextLegendAt) return;
  const alive = aliveSpecies();
  if (!alive.length) return;
  const species = pick(alive);
  const legendTypes = [
    'A colossal war-born individual appears at the edge of a ruined capital.',
    'A hidden prodigy rewrites the rules of siegecraft.',
    'A mutation creates a singular entity that changes the local ecosystem.',
    'A psychic anomaly grants one commander impossible foresight.',
    'A machine prophet begins broadcasting coordinates to every sensor grid.'
  ];
  logEvent('world', 'legend', {
    headline: 'A legend emerges',
    narrative: `${species.name} witnesses a once-in-an-age anomaly: ${pick(legendTypes)}`
  }, true);
  world.nextLegendAt = world.simSeconds + Math.floor(rand(72 * 3600, 240 * 3600));
}

function maybeTreaty() {
  const alive = aliveSpecies().filter(s => !s.eliminated);
  if (alive.length < 3) return;
  const weakest = [...alive].sort((a, b) => controlScore(a) - controlScore(b))[0];
  const secondWeakest = [...alive].sort((a, b) => controlScore(a) - controlScore(b))[1];
  if (!weakest || !secondWeakest) return;
  if (weakest.id === secondWeakest.id) return;
  const chance = weakest.pop < 1200 ? 0.12 : 0.03;
  if (Math.random() > chance) return;
  weakest.treatyWith = secondWeakest.id;
  secondWeakest.treatyWith = weakest.id;
  logEvent('world', 'treaty', {
    headline: `A fragile pact forms between ${weakest.name} and ${secondWeakest.name}.`,
    narrative: `The weakest powers choose survival over pride. For now, the two factions stop bleeding into each other and turn their eyes elsewhere.`,
    simple: `${weakest.name} and ${secondWeakest.name} sign a fragile pact.`
  });
}

function evolveStage(sp) {
  const before = sp.stageLevel;
  const next = stageFor(sp);
  sp.stageLevel = next.level;
  sp.stage = next.name;
  if (next.level !== before) {
    const stageLabels = ['spark', 'tribe', 'chiefdom', 'kingdom', 'empire', 'ascendant'];
    logEvent('species', 'evolution', {
      speciesId: sp.id,
      headline: `${sp.name} evolves into a ${next.name}.`,
      narrative: `${sp.name} crosses into the ${next.name} age. Its institutions, instincts, and tools are no longer primitive echoes; they are a new machine built from necessity.`,
      simple: `${sp.name} reaches the ${next.name} stage.`
    }, true);
  }
}

function attackOne(attacker, defender) {
  if (!attacker || !defender || attacker.eliminated || defender.eliminated) return [];

  const events = [];
  const advantage = matchup[attacker.id]?.[defender.id] || 0;
  const attPower = powerScore(attacker) * (0.9 + attacker.aggression * 0.6);
  const defPower = powerScore(defender) * (0.9 + defender.resilience * 0.4);
  const randomFactor = rand(0.7, 1.3);

  const damage = Math.max(0, (attPower * (1 + advantage) * randomFactor) - (defPower * (0.45 - advantage * 0.15)));
  const casualties = clamp(Math.round(damage / (6 + defender.stageLevel * 1.7)), 0, Math.max(1, Math.round(defender.pop * 0.35)));
  const territoryDamage = clamp(Math.round(casualties / (150 + defender.stageLevel * 20)), 0, 3);

  if (casualties > 0) {
    defender.pop = Math.max(0, defender.pop - casualties);
    defender.losses += casualties;
    attacker.kills += casualties;
  }
  defender.morale = clamp(defender.morale - casualties / Math.max(8000, defender.pop + casualties), 0.12, 1.4);
  attacker.morale = clamp(attacker.morale + 0.01, 0.2, 1.6);

  // Special attack styles
  if (attacker.id === 'goliaths') {
    const sectorIndex = getBorderCandidate(attacker.id, defender.id);
    if (sectorIndex !== null) {
      const sec = world.sectors[sectorIndex];
      sec.fortification = Math.max(0, sec.fortification - rand(0.35, 0.8));
      sec.devastation = clamp(sec.devastation + rand(0.1, 0.25), 0, 1);
      if (Math.random() < 0.52) {
        claimSector(attacker.id, sectorIndex);
        attacker.totalConquests += 1;
        events.push(logEvent('species', 'conquest', {
          speciesId: attacker.id,
          targetId: defender.id,
          headline: `${attacker.name} crushes a border sector of ${defender.name}.`,
          narrative: `${attacker.name} advances as a walking catastrophe, tearing through walls and turning the frontier into rubble.`,
          simple: `${attacker.name} takes a border sector from ${defender.name}.`
        }, true));
      } else {
        events.push(logEvent('species', 'battle', {
          speciesId: attacker.id,
          targetId: defender.id,
          headline: `${attacker.name} slams into ${defender.name}.`,
          narrative: `The impact is not a skirmish; it is geology in motion. ${defender.name} survives, but only by paying in blood and broken ground.`,
          simple: `${attacker.name} inflicts devastating melee damage on ${defender.name}.`
        }, true));
      }
    }
  } else if (attacker.id === 'vexill') {
    const growthBonus = Math.round(attacker.pop * 0.03 + attacker.territory * 12);
    attacker.pop += growthBonus;
    events.push(logEvent('species', 'growth', {
      speciesId: attacker.id,
      targetId: defender.id,
      headline: `${attacker.name} erupts in a fresh swarm bloom.`,
      narrative: `Loss means little to the brood. New bodies flood the field while the old ones become fuel for the next wave.`,
      simple: `${attacker.name} spawns ${growthBonus} new bodies.`
    }, true));
    if (Math.random() < 0.6) {
      const sectorIndex = getBorderCandidate(attacker.id, defender.id);
      if (sectorIndex !== null) {
        claimSector(attacker.id, sectorIndex);
        attacker.totalConquests += 1;
        events.push(logEvent('species', 'conquest', {
          speciesId: attacker.id,
          targetId: defender.id,
          headline: `${attacker.name} carpets a frontier in living matter.`,
          narrative: `The swarm does not capture territory so much as it becomes the territory. The old owners are simply outnumbered by existence itself.`,
          simple: `${attacker.name} spreads into ${defender.name}'s land.`
        }, true));
      }
    }
  } else if (attacker.id === 'othari') {
    const techDrain = clamp(rand(0.04, 0.18) + attacker.tech * 0.03, 0.02, 0.22);
    defender.tech = Math.max(0, defender.tech - techDrain);
    defender.resources = Math.max(0, defender.resources - Math.round(defender.resources * rand(0.04, 0.12)));
    if (Math.random() < 0.4) {
      const sectorIndex = getBorderCandidate(attacker.id, defender.id);
      if (sectorIndex !== null && Math.random() < 0.5) {
        claimSector(attacker.id, sectorIndex);
        attacker.totalConquests += 1;
      }
    }
    events.push(logEvent('species', 'sabotage', {
      speciesId: attacker.id,
      targetId: defender.id,
      headline: `${attacker.name} bends ${defender.name}'s systems against itself.`,
      narrative: `No front line is crossed. No banner is raised. Yet the enemy stumbles as weapons misfire, supply lines vanish, and certainty evaporates.`,
      simple: `${attacker.name} sabotages ${defender.name}.`
    }, true));
  } else if (attacker.id === 'xypherian') {
    const fortifyCount = Math.min(3, attacker.sectors.length);
    for (let i = 0; i < fortifyCount; i++) {
      const index = attacker.sectors[i];
      const sec = world.sectors[index];
      if (sec) sec.fortification = clamp(sec.fortification + rand(0.18, 0.45), 0, 2);
    }
    const artillery = Math.round(attPower * 0.14 + attacker.tech * 18);
    defender.pop = Math.max(0, defender.pop - artillery);
    defender.losses += artillery;
    events.push(logEvent('species', 'battle', {
      speciesId: attacker.id,
      targetId: defender.id,
      headline: `${attacker.name} rains artillery across the front.`,
      narrative: `The sky becomes a machine of fire. Defenses are not challenged one by one; they are erased from distance.`,
      simple: `${attacker.name} bombards ${defender.name}.`
    }, true));
    if (Math.random() < 0.5) {
      const sectorIndex = getBorderCandidate(attacker.id, defender.id);
      if (sectorIndex !== null) {
        claimSector(attacker.id, sectorIndex);
        attacker.totalConquests += 1;
      }
    }
  } else if (attacker.id === 'chimera') {
    const attackType = defender.id === 'goliaths' ? 'brute' : defender.id === 'vexill' ? 'swarm' : defender.id === 'othari' ? 'sabotage' : defender.id === 'xypherian' ? 'artillery' : 'arcane';
    attacker.adaptations[attackType] = clamp(attacker.adaptations[attackType] + rand(0.07, 0.2), 0, 2.5);
    const counterDamage = Math.round(attPower * (0.08 + attacker.adaptation * 0.03) * (1 + attacker.adaptations[attackType] * 0.15));
    defender.pop = Math.max(0, defender.pop - counterDamage);
    defender.losses += counterDamage;
    events.push(logEvent('species', 'evolution', {
      speciesId: attacker.id,
      targetId: defender.id,
      headline: `${attacker.name} rewrites itself after impact.`,
      narrative: `Each wound becomes a lesson. The strain learns the shape of the assault and returns with a more poisonous answer.`,
      simple: `${attacker.name} adapts against ${defender.name}.`
    }, true));
    if (Math.random() < 0.45) {
      const sectorIndex = getBorderCandidate(attacker.id, defender.id);
      if (sectorIndex !== null) {
        claimSector(attacker.id, sectorIndex);
        attacker.totalConquests += 1;
      }
    }
  }

  // generic territory pressure
  if (territoryDamage > 0) {
    const sectorIndex = getBorderCandidate(attacker.id, defender.id);
    if (sectorIndex !== null) {
      const sec = world.sectors[sectorIndex];
      sec.devastation = clamp(sec.devastation + territoryDamage * 0.08, 0, 1);
      if (Math.random() < 0.35) claimSector(attacker.id, sectorIndex);
    }
  }

  // collapse checks
  if (defender.pop <= 0 && !defender.eliminated) {
    defender.eliminated = true;
    defender.status = 'extinct';
    defender.territory = 0;
    events.push(logEvent('species', 'collapse', {
      speciesId: defender.id,
      targetId: attacker.id,
      headline: `${defender.name} collapses into extinction.`,
      narrative: `There is no longer a functioning homeland, only ruins and memory. The surviving powers now inherit a blank space where a civilization used to stand.`,
      simple: `${defender.name} has been eliminated.`
    }, true));
  } else if (defender.pop < Math.max(50, defender.territory * 12)) {
    defender.collapseTicks += 1;
    if (defender.collapseTicks >= 3) {
      events.push(logEvent('species', 'collapse', {
        speciesId: defender.id,
        targetId: attacker.id,
        headline: `${defender.name} enters systemic collapse.`,
        narrative: `${defender.name} can still fight, but the structure beneath the violence is failing. This is the beginning of the end, not yet the end itself.`,
        simple: `${defender.name} is in collapse.`
      }, false));
      defender.collapseTicks = 0;
    }
  } else {
    defender.collapseTicks = 0;
  }

  return events;
}

function stepSpeciesEconomy(sp) {
  if (sp.eliminated) return;
  const sectors = world.sectors.filter(s => s.owner === sp.id);
  const income = sectors.reduce((sum, s) => sum + (8 * s.richness + 5 * s.fertility) * (1 - s.devastation * 0.6), 0);
  const upkeep = Math.max(35, sp.pop * (0.018 + sp.territory * 0.0005));
  sp.resources += income - upkeep;

  if (sp.resources < 0) {
    const shortage = Math.abs(sp.resources);
    const losses = Math.round(shortage * (2.5 + sp.resilience));
    sp.pop = Math.max(0, sp.pop - losses);
    sp.losses += losses;
    sp.resources = 0;
    logEvent('species', 'collapse', {
      speciesId: sp.id,
      headline: `${sp.name} suffers starvation losses.`,
      narrative: `Supply failures spread faster than medicine or command. Hunger becomes another invader inside the borders.`,
      simple: `${sp.name} loses ${losses} population to shortages.`
    }, false);
  } else {
    const growthPressure = income / 220 + sp.resources / 1200 + sp.growth;
    const reproduction = Math.round(sp.pop * clamp(0.007 + growthPressure * 0.002, 0.004, 0.06));
    sp.pop += reproduction;
    if (reproduction > 0 && Math.random() < 0.18) {
      logEvent('species', 'growth', {
        speciesId: sp.id,
        headline: `${sp.name} expands organically.`,
        narrative: `Births, migrations, and new settlements quietly extend the species' reach without a single battlefield being crossed.`,
        simple: `${sp.name} grows by ${reproduction}.`
      }, false);
    }
  }

  // Tech and stage progression
  const techGain = (income / 5000) + (sp.territory * 0.004) + (sp.resources / 60000);
  sp.tech = clamp(sp.tech + techGain * (0.6 + sp.logistics * 0.3), 0, 12);

  if (sp.resources > 400) {
    sp.resources -= 90;
    sp.morale = clamp(sp.morale + 0.02, 0.5, 1.8);
  }

  // species-specific passive behavior
  if (sp.id === 'vexill') {
    const nestGain = Math.round(sp.territory * 2 + sp.resources * 0.015);
    sp.pop += nestGain;
    if (Math.random() < 0.25) {
      logEvent('species', 'growth', {
        speciesId: sp.id,
        headline: `${sp.name} breeds a new nest wave.`,
        narrative: `The brood does not wait for permission. It reproduces wherever the map leaves space, filling cracks with living bodies.`,
        simple: `${sp.name} adds ${nestGain} swarm units.`
      }, false);
    }
  } else if (sp.id === 'othari') {
    const influence = Math.round(sp.tech * 2 + sp.stealth * 1.5);
    sp.resources += influence * 2;
    if (Math.random() < 0.16) {
      const victim = chooseTarget(sp, world.species);
      if (victim && victim.id !== sp.id) {
        victim.resources = Math.max(0, victim.resources - influence * 4);
        logEvent('species', 'sabotage', {
          speciesId: sp.id,
          targetId: victim.id,
          headline: `${sp.name} quietly drains an enemy supply line.`,
          narrative: `The raid never looks like a raid. Someone simply wakes up to discover that a crucial piece of the war machine has gone missing.`,
          simple: `${sp.name} disrupts ${victim.name}'s logistics.`
        }, false);
      }
    }
  } else if (sp.id === 'xypherian') {
    const build = Math.min(3, sp.sectors.length);
    for (let i = 0; i < build; i++) {
      const idx = sp.sectors[i];
      const sec = world.sectors[idx];
      if (sec) sec.fortification = clamp(sec.fortification + 0.08 + sp.tech * 0.01, 0, 2.5);
    }
    sp.resources = Math.max(0, sp.resources - 25);
  } else if (sp.id === 'chimera') {
    const adaptiveHeal = Object.values(sp.adaptations).reduce((a, b) => a + b, 0) * 0.7;
    sp.pop += Math.round(adaptiveHeal);
    sp.resources += Math.round(sp.adaptation * 2);
  } else if (sp.id === 'goliaths') {
    // brute populations remain low, but individual strength matters
    if (sp.pop > 1500) sp.pop = Math.round(sp.pop * 0.995);
    sp.resources += 4;
  }

  evolveStage(sp);
}

function chooseActions() {
  const alive = aliveSpecies();
  const order = [...alive].sort((a, b) => controlScore(b) - controlScore(a));
  for (const sp of order) {
    if (sp.eliminated) continue;
    const target = chooseTarget(sp, alive);
    if (!target) continue;

    // species-specific decision making
    let attackChance = 0.42 + sp.aggression * 0.35;
    if (sp.id === 'othari') attackChance = 0.5 + sp.stealth * 0.12;
    if (sp.id === 'xypherian') attackChance = 0.45 + sp.tech * 0.05;
    if (sp.id === 'vexill') attackChance = 0.68;
    if (sp.id === 'chimera') attackChance = 0.55;

    if (Math.random() > attackChance) continue;

    // reduce attack frequency if treaty exists
    if (sp.treatyWith === target.id && Math.random() < 0.75) continue;

    attackOne(sp, target);
  }
}

function handleTerritoryDynamics() {
  for (const sp of world.species) {
    if (sp.eliminated) continue;
    const borders = borderSectors(sp.id);
    if (!borders.length) continue;

    // expand occasionally into neutral or weak adjacent territory
    const expansionChance = sp.id === 'vexill'
      ? 0.45
      : sp.id === 'goliaths'
        ? 0.22
        : sp.id === 'othari'
          ? 0.18
          : sp.id === 'xypherian'
            ? 0.27
            : 0.3;

    if (Math.random() > expansionChance) continue;
    const chosenBorder = pick(borders);
    const targetIndex = sectorNeighbors(chosenBorder).find(i => world.sectors[i].owner !== sp.id);
    if (targetIndex === undefined) continue;
    const targetSector = world.sectors[targetIndex];
    const oldOwner = targetSector.owner;
    if (!oldOwner || Math.random() < 0.5 + sp.tech * 0.03 + sp.aggression * 0.08) {
      claimSector(sp.id, targetIndex);
      sp.totalConquests += 1;
      if (oldOwner && oldOwner !== sp.id) {
        const defender = getSpecies(oldOwner);
        if (defender) defender.resources = Math.max(0, defender.resources - 18);
      }
      logEvent('species', 'conquest', {
        speciesId: sp.id,
        targetId: oldOwner || null,
        headline: `${sp.name} expands into new ground.`,
        narrative: `The frontier shifts by inches, then by meters, then suddenly by the logic of a new ruler.`,
        simple: `${sp.name} captures a new sector.`
      }, false);
    }
  }
}

function evaluateWorldState() {
  refreshTerritories();
  updateLeader();
  maybeTreaty();
  maybeLegend();

  // all species extinct? reset to avoid dead sim
  if (aliveCount() === 0) {
    initWorld();
    logEvent('world', 'reset', {
      headline: 'The continent goes silent, then the cycle begins again.',
      narrative: 'When every faction falls, the world does not stop. It remembers and reopens the wound with fresh sparks.',
      simple: 'All species are extinct. The world resets.'
    }, true);
  }
}

function stepSimulation(seconds) {
  world.simSeconds += seconds;
  for (const sp of world.species) {
    if (sp.treatyWith && getSpecies(sp.treatyWith)?.eliminated) sp.treatyWith = null;
  }
  // economy first
  for (const sp of world.species) stepSpeciesEconomy(sp);
  // then conflicts
  chooseActions();
  handleTerritoryDynamics();
  evaluateWorldState();
}

function tick() {
  const now = Date.now();
  const elapsedMs = now - world.lastRealTick;
  world.lastRealTick = now;
  if (!world.running) return;

  const safeMs = clamp(elapsedMs, 0, 3000);
  world.accumulator += safeMs * (SIM_SECONDS_PER_REAL_SECOND / 1000);

  while (world.accumulator >= STEP_SECONDS) {
    stepSimulation(STEP_SECONDS);
    world.accumulator -= STEP_SECONDS;
  }

  // leftover smaller chunk keeps time continuous
  if (world.accumulator > 0 && Math.random() < 0.15) {
    const leftover = Math.min(world.accumulator, STEP_SECONDS / 2);
    stepSimulation(leftover);
    world.accumulator -= leftover;
  }

  broadcast({ type: 'state', state: getState() });
}

function getState() {
  refreshTerritories();
  const alive = aliveSpecies().sort((a, b) => controlScore(b) - controlScore(a));
  const leader = alive[0] || null;
  return {
    running: world.running,
    simSeconds: world.simSeconds,
    simLabel: simLabel(world.simSeconds),
    speed: '1 real second = 10h 9m simulation',
    leader: leader ? { id: leader.id, name: leader.name } : null,
    species: world.species.map(sp => ({
      id: sp.id,
      name: sp.name,
      alias: sp.alias,
      motto: sp.motto,
      color: sp.color,
      style: sp.style,
      pop: round(sp.pop),
      resources: round(sp.resources),
      tech: Number(sp.tech.toFixed(2)),
      aggression: Number(sp.aggression.toFixed(2)),
      logistics: Number(sp.logistics.toFixed(2)),
      stealth: Number(sp.stealth.toFixed(2)),
      resilience: Number(sp.resilience.toFixed(2)),
      adaptation: Number(sp.adaptation.toFixed(2)),
      siege: Number(sp.siege.toFixed(2)),
      growth: Number(sp.growth.toFixed(2)),
      morale: Number(sp.morale.toFixed(2)),
      territory: sp.territory,
      stage: sp.stage,
      stageLevel: sp.stageLevel,
      kills: round(sp.kills),
      losses: round(sp.losses),
      status: sp.eliminated ? 'extinct' : sp.status,
      strategy: strategyNames[sp.id][Math.min(strategyNames[sp.id].length - 1, sp.stageLevel % strategyNames[sp.id].length)] || sp.strategy,
      treatyWith: sp.treatyWith,
      adaptations: sp.adaptations
    })),
    logs: world.logs.slice(0, 80),
    meta: {
      sectorCount: world.sectors.length,
      aliveCount: aliveCount(),
      leaderName: leader ? leader.name : 'None',
      worldSeed: 'procedural'
    },
    sectors: world.sectors.map(s => ({
      index: s.index,
      owner: s.owner,
      fortification: Number(s.fortification.toFixed(2)),
      devastation: Number(s.devastation.toFixed(2)),
      climate: s.climate
    }))
  };
}

app.get('/api/state', (req, res) => res.json(getState()));

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  clients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'state', state: getState() })}\n\n`);
  req.on('close', () => {
    clients.delete(res);
  });
});

app.post('/api/control', (req, res) => {
  const action = req.body?.action;
  if (action === 'start') world.running = true;
  if (action === 'pause') world.running = false;
  if (action === 'reset') initWorld();
  if (action === 'toggle') world.running = !world.running;
  broadcast({ type: 'state', state: getState() });
  res.json({ ok: true, running: world.running });
});

app.post('/api/config', (req, res) => {
  if (typeof req.body?.webhookUrl === 'string') {
    world.webhookUrl = req.body.webhookUrl.trim();
  }
  broadcast({ type: 'state', state: getState() });
  res.json({ ok: true, webhookConfigured: !!world.webhookUrl });
});

app.get('/api/config', (req, res) => {
  res.json({ webhookConfigured: !!world.webhookUrl });
});

app.post('/api/step', (req, res) => {
  stepSimulation(STEP_SECONDS);
  broadcast({ type: 'state', state: getState() });
  res.json({ ok: true });
});

initWorld();
setInterval(tick, 1000);

app.listen(PORT, () => {
  console.log(`Simulation server running on port ${PORT}`);
});
