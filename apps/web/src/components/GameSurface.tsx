'use client';

/**
 * HEIRLOM — the game surface.
 *
 * The markup is the prototype's, converted to JSX and otherwise untouched. React
 * renders the chrome once and then stays out of the way: the canvas, the panels
 * and the specimen plate are all driven imperatively by the ported UI layer,
 * which is what keeps the renderer a straight port rather than a rewrite.
 */

import { useEffect, useRef, useState } from 'react';
import { bootGame } from '@/game/boot';

export default function GameSurface() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let teardown: (() => void) | undefined;
    let cancelled = false;

    bootGame(canvas)
      .then((stop) => {
        if (cancelled) stop();
        else teardown = stop;
      })
      .catch((err) => setError(err?.message ?? 'Could not reach the estate.'));

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, []);

  return (
    <>
      <canvas id="stage" ref={canvasRef} />

      {/* HUD */}
      <div className="hud">
        <div className="brandmark"><b>HEIRLOM</b><i>Est. Vale</i></div>
        <div className="purse">
          <div className="coinbox coinbox--coin"><i>◆</i><span id="hudCoins">0</span></div>
          <div className="coinbox coinbox--seed"><i>✦</i><span id="hudSeed">0.00</span></div>
        </div>
        <div className="lvl">
          <div className="lvl__badge" id="hudLevel">1</div>
          <div className="xp">
            <div className="xp__track"><i id="xpFill"></i></div>
            <div className="xp__meta"><span id="xpText">0 / 0</span><span id="hudPhase">Morning</span></div>
          </div>
        </div>
        {/* Today's tasks. In the HUD rather than the dock: the dock already
            carries seven destinations, and this needs to be seen without
            being looked for. */}
        {/* Labelled, not a bare glyph. The first version was an unlabelled ✦
            and players simply did not find it — a retention hook nobody can
            see is not a hook. */}
        <button className="dailybtn" id="btnDaily" title="Today's tasks">
          <i>✦</i><b>Today</b><span id="dailyCount">0/3</span>
          <em className="iconbtn__badge" id="dailyBadge"></em>
        </button>
        <button className="iconbtn" id="btnHelp" title="How breeding works">?</button>
        <button className="iconbtn" id="btnMute" title="Sound on">♪</button>
      </div>

      <div className="quickbar">
        <button className="harvestall" id="harvestAll">Harvest all ripe beds <b id="harvestAllN">0</b></button>
        <button className="harvestall harvestall--plant" id="plantAll">Sow every empty bed <b id="plantAllN">0</b></button>
      </div>

      {/* dock */}
      <nav className="dock">
        <button className="dock__btn" data-panel="vault">
          <svg viewBox="0 0 24 24"><path d="M12 3c3 3 4.5 5.5 4.5 8a4.5 4.5 0 0 1-9 0c0-2.5 1.5-5 4.5-8Z"/><path d="M12 11v10"/></svg>
          <span>Vault</span>
        </button>
        <button className="dock__btn" data-panel="bench">
          <svg viewBox="0 0 24 24"><circle cx="6.5" cy="17.5" r="3"/><circle cx="17.5" cy="17.5" r="3"/><path d="M6.5 14.5V9m11 5.5V9M6.5 9h11M12 9V3"/></svg>
          <span>Bench</span>
        </button>
        <button className="dock__btn" data-panel="codex">
          <svg viewBox="0 0 24 24"><path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4Z"/><path d="M20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7Z"/></svg>
          <span>Herbarium</span>
        </button>
        <button className="dock__btn" data-panel="market">
          <svg viewBox="0 0 24 24"><path d="M3 8h18l-1.5 9.5a2 2 0 0 1-2 1.5H6.5a2 2 0 0 1-2-1.5Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/></svg>
          <span>Market</span>
        </button>
        <button className="dock__btn" data-panel="exchange">
          <svg viewBox="0 0 24 24"><path d="M3 6h18M7 6V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/><path d="M8 11v6M12 11v6M16 11v6"/></svg>
          <span>Exchange</span>
        </button>
        <button className="dock__btn" data-panel="estate">
          <svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V9l7-5 7 5v12"/><path d="M10 21v-6h4v6"/></svg>
          <span>Estate</span>
        </button>
        <button className="dock__btn" data-panel="commission" id="dockCommission">
          <svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4Z"/><path d="M9 8h6M9 12h4"/></svg>
          <span>Commissions</span>
        </button>
      </nav>

      {/* panel */}
      <aside className="panel" id="panel">
        <div className="panel__head">
          <h2 id="panelTitle">Seed vault</h2>
          <p id="panelSub"></p>
          <button className="panel__close" id="panelClose">✕</button>
        </div>
        <div className="panel__body" id="panelBody"></div>
      </aside>

      {/* seed picker */}
      <div className="modal" id="picker">
        <div className="sheet">
          <div className="sheet__head">
            <h3>Choose a seed</h3>
            <p>Yield, hardiness and colour will all show in the plant itself.</p>
            <button className="sheet__close" id="pickerClose">✕</button>
          </div>
          <div className="sheet__body" id="pickerList"></div>
        </div>
      </div>

      {/* specimen plate */}
      <div className="modal" id="plate">
        <div className="plate">
          <div className="plate__ribbon" id="plateRibbon">Common</div>
          <div className="plate__eyebrow">Vale Herbarium · Accession <span id="plateAcc">HB-0000</span></div>
          <div className="plate__species" id="plateSpecies">Tomato</div>
          <div className="plate__latin" id="plateLatin">Solanum lycopersicum</div>
          <canvas className="plate__art" id="plateCanvas"></canvas>
          <div className="plate__name" id="plateName">Unnamed</div>
          <div className="plate__gen" id="plateGen">Generation 0</div>
          <div className="plate__rule"></div>
          <div className="plate__notation" id="plateNotation">Y11 V11 H11 E11 CC</div>
          <div className="plate__carry" id="plateCarry"></div>
          <div className="plate__traits" id="plateTraits"></div>
          <div className="plate__meta">
            <div><span>Collected</span><b id="plateDate">—</b></div>
            <div><span>Breeding score</span><b id="plateScore">0</b></div>
            <div><span>Recorded by</span><b id="plateBy">A. Vale</b></div>
            <div><span>Locality</span><b>Vale estate, west beds</b></div>
          </div>
          <div className="plate__parents" id="plateParents"></div>
          <div className="plate__mut" id="plateMut"></div>
          <div className="plate__namewrap" id="plateNameWrap" style={{ display: 'none' }}>
            <label htmlFor="plateInput">Name this strain</label>
            <input id="plateInput" maxLength={26} autoComplete="off" />
          </div>
          <div className="plate__actions">
            <button className="btn" id="plateClose">Close</button>
            <button className="btn btn--ghost" id="plateShare" style={{ display: 'none' }}>Share</button>
            <button className="btn btn--brass" id="plateSave">Press into herbarium</button>
          </div>
        </div>
      </div>

      {/* guided tutorial */}
      <div className="coach" id="coach">
        <div className="coach__hole" id="coachHole"></div>
        <div className="coach__card" id="coachCard" data-caret="up">
          <div className="coach__step" id="coachStep">Step 1</div>
          <div className="coach__title" id="coachTitle"></div>
          <div className="coach__body" id="coachBody"></div>
          <div className="coach__hint" id="coachHint"></div>
          <div className="coach__foot">
            <div className="coach__dots" id="coachDots"></div>
            <div className="coach__btns">
              <button className="coach__skip" id="coachSkip">Skip</button>
              <button className="coach__next" id="coachNext">Got it</button>
            </div>
          </div>
        </div>
      </div>

      <div className="levelbanner" id="levelBanner"><i>Level</i><b id="levelBannerN">2</b></div>
      <div id="toasts"></div>

      {/* title */}
      <div className="title" id="title">
        <div className="title__mark">
          <i>A breeding farm</i>
          <h1>HEIRLOM</h1>
          <div className="title__rule"></div>
          <div className="title__tag">Anyone can grow a crop. Few can fix a line.</div>
        </div>
        <div className="title__sheet">
          <p className="title__lede">Every plant carries <b>two alleles at five loci</b>. Cross two parents and the offspring takes one from each — so the plainest seed in your vault may be hiding the colour you have been chasing for twenty generations.</p>
          <div className="title__facts">
            <div className="tfact"><b>5</b><span>Genes</span></div>
            <div className="tfact"><b>5</b><span>Colour morphs</span></div>
            <div className="tfact"><b>~200</b><span>Crosses to Ivory</span></div>
          </div>
          <button className="title__start" id="start">Walk out to the beds</button>
          <button className="title__skip" id="skipTut">I know how breeding works — skip the tutorial</button>
        </div>
      </div>

      {error ? (
        <div className="bootfail" role="alert">
          <b>The garden is unreachable.</b>
          <span>{error}</span>
        </div>
      ) : null}
    </>
  );
}
