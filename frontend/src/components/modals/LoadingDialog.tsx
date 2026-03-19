import React, { useMemo, useEffect } from 'react';
import { useExecutionStore } from '@store/slices/executionSlice';
import { useEditorStore } from '@store/slices/editorSlice';
import { AlertCircle, Terminal, CheckCircle2 } from 'lucide-react';
import './LoadingDialog.css';

const STAGE_MAP: Record<string, number> = {
  starting: 0,
  compiling: 1,
  executing: 2,
  tracing: 3,
  parsing: 4,
  sending: 5,
  complete: 6,
};

const STEPS = [
  'Receiving source code',
  'Compiling with Clang + tracer injection',
  'Running instrumented binary',
  'Collecting trace events (FRAME PUSH / POP)',
  'Parsing trace → JSON step objects',
  'Sending steps to frontend canvas',
];

export default function LoadingDialog() {
  const { 
    isAnalyzing, 
    analysisProgress, 
    analysisStage, 
    analysisError, 
    analysisStartTime,
    analysisStageDurations,
    totalGeneratedSteps,
    executionTrace,
    dismissAnalysisResult
  } = useExecutionStore();
  
  const currentStageIdx = STAGE_MAP[analysisStage] ?? -1;
  const isError = !!analysisError;
  const isComplete = analysisStage === 'complete';

  // Auto-dismiss after 5 seconds of completion
  useEffect(() => {
    if (isComplete) {
      const timer = setTimeout(() => {
        dismissAnalysisResult();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isComplete, dismissAnalysisResult]);

  if (analysisStage === 'idle' && !isError) return null;

  return (
    <div className="cv-dialog-overlay">
      <div className={`cv-dialog ${isError ? 'has-error' : ''}`}>
        
        {/* TITLEBAR */}
        <div className="dlg-tbar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke={isError ? '#EF4444' : 'var(--acc3)'} strokeWidth="1.2" opacity=".4"/>
            <circle cx="8" cy="8" r="3.5" fill={isError ? '#EF4444' : 'var(--acc)'} opacity=".5"/>
            <circle cx="8" cy="8" r="1.5" fill={isError ? '#FCA5A5' : 'var(--accL)'}/>
          </svg>
          <span className="dlg-tbar-title">
            {isError ? 'Execution Failed' : isComplete ? 'Visualization Ready' : 'Preparing Visualization'}
          </span>
          <span className="lang-badge">
            {isError ? 'Error' : isComplete ? 'Complete' : analysisStage.charAt(0).toUpperCase() + analysisStage.slice(1)}
          </span>
        </div>

        {/* PIPELINE FIGURE */}
        <div className="dlg-figure">
          <svg width="100%" viewBox="0 0 560 118" fill="none" style={{ overflow: 'visible', maxWidth: '560px' }}>
            {/* STAGE LABELS */}
            <text x="46"  y="12" textAnchor="middle" className="fig-label">Source</text>
            <text x="163" y="12" textAnchor="middle" className="fig-label">Compile + Trace</text>
            <text x="295" y="12" textAnchor="middle" className="fig-label">Trace Events</text>
            <text x="415" y="12" textAnchor="middle" className="fig-label">JSON Steps</text>
            <text x="520" y="12" textAnchor="middle" className="fig-label">Frontend</text>

            {/* BLOCK 1: C++ SOURCE */}
            <rect x="10" y="22" width="72" height="72" rx="9" fill="var(--bg0)" stroke="var(--bd2)" strokeWidth="1"/>
            <rect x="18" y="32" width="30" height="4" rx="2" fill="#C084FC" opacity=".8"/>
            <rect x="50" y="32" width="22" height="4" rx="2" fill="var(--t2)" opacity=".5"/>
            <rect x="18" y="42" width="20" height="4" rx="2" fill="#60A5FA" opacity=".7"/>
            <rect x="38" y="52" width="32" height="4" rx="2" fill="#34D399" opacity=".7"/>

            {/* ARROW 1: Source -> Compiler */}
            <line className="pipe"  x1="85" y1="51" x2="117" y2="51" stroke="var(--acc)" strokeWidth="1.2"/>
            <line className="pipe2" x1="85" y1="59" x2="117" y2="59" stroke="var(--accL)" strokeWidth="1" opacity=".6"/>

            {/* BLOCK 2: CLANG + TRACER */}
            <circle className="rp1" cx="163" cy="58" r="18" fill="none" stroke="var(--acc)" strokeWidth="1" opacity=".5"/>
            <rect x="127" y="22" width="72" height="72" rx="9" fill="var(--bg3)" stroke={currentStageIdx >= 1 ? 'var(--acc)' : 'var(--bd)'} strokeWidth="1.5"/>
            <text x="163" y="36" textAnchor="middle" fontSize="8" fontFamily="monospace" fill="var(--accL)">CLANG</text>
            <g className={!isComplete && currentStageIdx === 1 ? "g1" : ""}>
              <circle cx="163" cy="55" r="8" fill="none" stroke="var(--acc)" strokeWidth="1.3"/>
            </g>
            <rect x="133" y="72" width="60" height="14" rx="4" fill="rgba(59,130,246,.15)" stroke="rgba(59,130,246,.3)" strokeWidth=".8"/>
            <text x="163" y="82" textAnchor="middle" fontSize="7.5" fontFamily="monospace" fill="var(--acc3)">+ tracer</text>

            {/* ARROW 2: Compiler -> Trace Events */}
            <line x1="202" y1="54" x2="252" y2="54" stroke="var(--bd2)" strokeWidth="1.5"/>
            {!isComplete && currentStageIdx >= 2 && currentStageIdx <= 3 && (
              <>
                <g className="tok1"><rect x="202" y="47" width="28" height="11" rx="3" fill="rgba(124,58,237,.3)" stroke="var(--acc)" strokeWidth=".8"/></g>
                <g className="tok2"><rect x="202" y="47" width="26" height="11" rx="3" fill="rgba(16,185,129,.2)" stroke="var(--acc2)" strokeWidth=".8"/></g>
              </>
            )}

            {/* BLOCK 3: TRACE EVENTS */}
            <rect x="256" y="22" width="78" height="72" rx="9" fill="var(--bg0)" stroke={currentStageIdx >= 3 ? 'var(--acc)' : 'var(--bd2)'} strokeWidth="1"/>
            <text x="295" y="36" textAnchor="middle" fontSize="7" fontFamily="monospace" fill="var(--t3)">raw trace</text>

            {/* ARROW 3: Trace Events -> JSON Steps */}
            <line className="pipe" x1="337" y1="51" x2="375" y2="51" stroke="var(--acc2)" strokeWidth="1.2"/>

            {/* BLOCK 4: JSON STEPS */}
            <rect x="379" y="22" width="72" height="72" rx="9" fill="var(--bg0)" stroke={currentStageIdx >= 4 ? 'var(--acc2)' : 'var(--bd2)'} strokeWidth="1" opacity=".8"/>
            <text x="415" y="34" textAnchor="middle" fontSize="7" fontFamily="monospace" fill="var(--acc2)">{'{steps}'}</text>
            <rect x="385" y="79" width="62" height="11" rx="3" fill="rgba(16,185,129,.12)"/>
            <text x="415" y="88" textAnchor="middle" fontSize="7" fontFamily="monospace" fill="var(--acc2)">
              {totalGeneratedSteps ? `${totalGeneratedSteps} steps` : 'analyzing...'}
            </text>

            {/* ARROW 4: JSON -> Frontend */}
            <line className="pipe" x1="454" y1="54" x2="492" y2="54" stroke="var(--acc3)" strokeWidth="1.2"/>

            {/* BLOCK 5: FRONTEND */}
            <rect x="494" y="22" width="58" height="72" rx="9" fill="var(--bg0)" stroke={currentStageIdx >= 5 ? 'var(--acc3)' : 'var(--bd2)'} strokeWidth="1" opacity=".8"/>
            <text x="523" y="92" textAnchor="middle" fontSize="6.5" fontFamily="monospace" fill="var(--acc3)" opacity=".7">canvas</text>
          </svg>
        </div>

        {/* STEPS LIST */}
        <div className="dlg-steps">
          {STEPS.map((step, idx) => {
            const stageKey = Object.keys(STAGE_MAP).find(key => STAGE_MAP[key] === idx);
            let status = 's-pending';
            if (isError && idx === currentStageIdx) status = 's-error';
            else if (isComplete || idx < currentStageIdx) status = 's-done';
            else if (idx === currentStageIdx) status = 's-active';

            const duration = stageKey ? analysisStageDurations[stageKey] : null;

            return (
              <div key={idx} className={`step-item ${status}`}>
                <div className="step-dot" />
                <span className="step-label">{step}</span>
                {status === 's-active' && !isError && <span className="step-tag">in progress</span>}
                {status === 's-done' && (
                  <span className="step-meta">
                    {duration ? `${duration.toFixed(1)}s` : '0.1s'}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* PROGRESS BAR */}
        <div className="dlg-progress">
          <div className="prog-head">
            <span>
              {isError 
                ? 'Error encountered during execution' 
                : isComplete 
                ? `Trace ready — ${totalGeneratedSteps} execution steps`
                : `${analysisStage}...`}
            </span>
            <span>{isError ? 'Failed' : `${analysisProgress}%`}</span>
          </div>
          <div className="prog-track">
            <div 
              className={`prog-fill ${isError ? 'is-error' : ''}`} 
              style={{ width: `${isError ? 100 : analysisProgress}%` }} 
            />
          </div>
        </div>

        {/* STATS ROW (appears when done) */}
        {isComplete && (
          <div className="stats-row show flex gap-2 flex-wrap px-[22px] pb-4 animate-in fade-in duration-500">
            <div className="stat-chip flex items-center gap-1.5 bg-bg0 border border-bd2 rounded-md px-2.5 py-1 text-[10px] font-mono text-t2">
              Steps <span className="text-acc2 font-medium">{totalGeneratedSteps}</span>
            </div>
            <div className="stat-chip flex items-center gap-1.5 bg-bg0 border border-bd2 rounded-md px-2.5 py-1 text-[10px] font-mono text-t2">
              Functions <span className="text-acc2 font-medium">{executionTrace?.totalSteps ? Math.floor(totalGeneratedSteps! / 3) : 0}</span>
            </div>
          </div>
        )}

        {/* NOTE / ERROR BOX */}
        <div className={`dlg-note ${isError ? 'is-error' : ''}`}>
          {isError ? (
            <AlertCircle className="h-4 w-4 text-red-500 mt-0.5" />
          ) : isComplete ? (
            <CheckCircle2 className="h-4 w-4 text-acc2 mt-0.5" />
          ) : (
            <Terminal className="h-4 w-4 text-blue-500 mt-0.5" />
          )}
          <div className="note-body">
            {isError ? (
              <>
                <strong>Execution Error:</strong>
                <div className="mt-1 font-mono text-[10px] break-all bg-black/20 p-2 rounded border border-red-500/20">
                  {analysisError}
                </div>
              </>
            ) : isComplete ? (
              <>
                <strong>Visualization ready.</strong> We've successfully captured {totalGeneratedSteps} execution steps. Click "Launch" or click anywhere to explore the trace on the canvas.
              </>
            ) : (
              <>
                <strong>Pipeline active.</strong> Every function call is being traced as a <code>PUSH/POP</code> event, parsed into <code>JSON</code>, and streamed to the canvas.
              </>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <div className="dlg-footer">
          <span className="dlg-cmd">
            {isError ? 'Process terminated with non-zero exit code' : isComplete ? 'Trace generated and optimized successfully' : `clang++ -O2 -finstrument-functions main.cpp`}
          </span>
          {isComplete ? (
            <button 
              className="dlg-cancel !cursor-pointer !opacity-100 !border-acc2 !text-acc2 hover:bg-acc2/10"
              onClick={dismissAnalysisResult}
            >
              Launch
            </button>
          ) : (
            <button className="dlg-cancel" disabled>Cancel</button>
          )}
        </div>

      </div>
    </div>
  );
}
