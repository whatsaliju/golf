// Telemetry HUD wiring. Same panels as the original demo, but fed by the real
// computed yardage / elevation change and the live camera altitude.

const $ = (id) => document.getElementById(id);

const BADGE = {
  live: { text: 'LIVE · OSM + DEM + IMAGERY', cls: '' },
  baked: { text: 'BAKED · REAL DATA', cls: '' },
  placeholder: { text: 'PLACEHOLDER · LIVE FETCH FAILED', cls: 'err' },
};

export function createHud() {
  const els = {
    title: $('holeTitle'), sub: $('holeSub'), badge: $('dataBadge'),
    dist: $('distVal'), elev: $('elevVal'), alt: $('altVal'),
    prog: $('progVal'), fill: $('progressFill'), note: $('sourceNote'),
  };

  function setHole(meta, hole) {
    const par = hole.par ? ` · Par ${hole.par}` : '';
    els.title.textContent = meta.title;
    els.sub.textContent = `${meta.subtitle}${par}`;
    const b = BADGE[meta.source] || BADGE.live;
    els.badge.textContent = b.text;
    els.badge.className = `hud-badge ${b.cls}`;

    if (hole.elevationChangeFt == null) {
      els.elev.innerHTML = 'n/a<span>ft</span>';
    } else {
      const s = hole.elevationChangeFt >= 0 ? '+' : '';
      els.elev.innerHTML = `${s}${hole.elevationChangeFt}<span>ft</span>`;
    }

    const bits = [meta.location, `${hole.yardage} yd`, meta.attribution].filter(Boolean);
    els.note.innerHTML = bits.map((b2, i) => (i === 2 ? `<b>${b2}</b>` : b2)).join('<br>');
    if (meta.source === 'placeholder' && meta.reason) {
      els.note.innerHTML += `<br><span style="color:#e07a6b">${meta.reason}</span>`;
    }
  }

  function update(frame, progress, hole) {
    const remaining = Math.round(hole.yardage * (1 - Math.min(progress * 1.3, 1)));
    els.dist.innerHTML = `${Math.max(remaining, 0)}<span>yd</span>`;
    els.alt.innerHTML = `${Math.round(frame.altitude * 3.281)}<span>ft AGL</span>`;
    els.prog.innerHTML = `${Math.round(progress * 100)}<span>%</span>`;
    els.fill.style.width = `${progress * 100}%`;
  }

  return { setHole, update, els };
}
