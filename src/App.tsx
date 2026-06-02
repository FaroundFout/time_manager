import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Check,
  Clock,
  FileText,
  History,
  PauseCircle,
  Play,
  RefreshCw,
  Settings,
  Square,
  TimerReset,
  Upload
} from "lucide-react";
import { parseScheduleMarkdown, ScheduleParseError } from "./domain/scheduleParser";
import { evaluateReminder } from "./domain/reminderEngine";
import { buildWorkdayFromTemplate } from "./domain/timeEngine";
import { reduceSnapshot } from "./domain/stateMachine";
import { createDefaultConfig, LocalStoragePort } from "./domain/storage";
import { formatClock, formatDuration, minutesBetween, minutesBetweenIso, toIso } from "./domain/time";
import type { AppConfig, AppSnapshot, ParsedTemplate, StageInstance, TimelineSegment, WorkdayStatus } from "./domain/types";
import {
  getNotificationAvailability,
  hideReminderWindow,
  isDesktopRuntime,
  onExitRequested,
  onNotificationInteraction,
  onReminderAction,
  onSnapshotUpdated,
  pickMarkdownFile,
  playReminderSound,
  requestExitApp,
  sendReminderAction,
  sendSnapshotUpdated,
  sendSystemReminder,
  showMainWindow,
  showReminderWindow
} from "./platform/desktopBridge";
import type { ReminderAction } from "./platform/desktopBridge";

type View = "today" | "history" | "settings";

const storage = new LocalStoragePort();
const isReminderView = window.location.hash === "#reminder";

const exampleMarkdown = `日程起点: 08:00

- 08:00-08:30 起床
- 08:30-09:00 早餐
- 09:00-11:30 学习 # 备注：数学
- 11:30-13:00 午饭
- 13:00-14:30 学习
- 14:30-15:00 休息`;

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | undefined>();
  const [view, setView] = useState<View>("today");
  const [draftMarkdown, setDraftMarkdown] = useState(exampleMarkdown);
  const [sourcePath, setSourcePath] = useState("");
  const [parseError, setParseError] = useState("");
  const [preview, setPreview] = useState<ParsedTemplate | undefined>();
  const [now, setNow] = useState(new Date());
  const [incidentNote, setIncidentNote] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processedReminderRef = useRef("");

  useEffect(() => {
    storage.loadSnapshot().then((loaded) => {
      if (loaded) {
        const recovered = isReminderView ? loaded : { ...loaded, reminderWindowVisible: false };
        setSnapshot(isReminderView ? recovered : reduceSnapshot(recovered, { type: "tick", now: new Date() }));
      }
    });
  }, []);

  useEffect(() => {
    if (isReminderView) return;
    const timer = window.setInterval(() => {
      const current = new Date();
      setNow(current);
      setSnapshot((currentSnapshot) => {
        if (!currentSnapshot) return currentSnapshot;
        return reduceSnapshot(currentSnapshot, { type: "tick", now: current });
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (snapshot && !isReminderView) {
      storage.saveSnapshot(snapshot);
      void sendSnapshotUpdated(snapshot);
    }
  }, [snapshot]);

  useEffect(() => {
    if (isReminderView || !snapshot || snapshot.notificationStatus) return;
    getNotificationAvailability().then((notificationStatus) => {
      setSnapshot((current) => (current ? { ...current, notificationStatus } : current));
    });
  }, [snapshot?.notificationStatus, snapshot]);

  useEffect(() => {
    if (isReminderView || !snapshot) return;
    const evaluation = evaluateReminder(snapshot, new Date());
    const effectKey = evaluation.payload
      ? `${evaluation.payload.key}:${evaluation.snapshot.lastReminderAt ?? ""}`
      : "";

    if (evaluation.changed) {
      setSnapshot(evaluation.snapshot);
    }

    if (!evaluation.payload) {
      if (snapshot.reminderWindowVisible || snapshot.activeReminderKey) {
        void hideReminderWindow();
      }
      return;
    }

    if (effectKey && effectKey !== processedReminderRef.current) {
      processedReminderRef.current = effectKey;
      if (evaluation.shouldShowWindow) void showReminderWindow(evaluation.payload);
      if (evaluation.shouldNotify) void sendSystemReminder(evaluation.payload);
      if (evaluation.shouldPlaySound) void playReminderSound();
    }
  }, [snapshot]);

  useEffect(() => {
    if (!isReminderView) return;
    let unlisten: (() => void) | undefined;
    onSnapshotUpdated((updated) => {
      setSnapshot(updated);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (isReminderView) return;
    let unlisten: (() => void) | undefined;
    onExitRequested(() => {
      void confirmAndExit();
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (isReminderView) return;
    let unlisten: (() => void) | undefined;
    onReminderAction((action) => {
      handleReminderAction(action);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (isReminderView) return;
    let unlisten: (() => void) | undefined;
    onNotificationInteraction(() => {
      void showMainWindow();
      if (snapshot?.reminderWindowVisible && snapshot.activeReminderKey) {
        const evaluation = evaluateReminder(snapshot, new Date());
        if (evaluation.payload) void showReminderWindow(evaluation.payload);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, [snapshot]);

  const currentStage = useMemo(
    () => snapshot?.stages.find((stage) => stage.id === snapshot.workdayState.currentStageId),
    [snapshot]
  );

  if (isReminderView) {
    return <ReminderWindowView snapshot={snapshot} currentStage={currentStage} />;
  }

  function parseDraft() {
    try {
      const parsed = parseScheduleMarkdown(draftMarkdown, sourcePath || undefined);
      setPreview(parsed);
      setParseError("");
    } catch (error) {
      setPreview(undefined);
      if (error instanceof ScheduleParseError) {
        setParseError(error.message);
      } else {
        setParseError((error as Error).message);
      }
    }
  }

  function applyPickedMarkdownFile(path: string, text: string) {
    setSourcePath(path);
    setDraftMarkdown(text);
    setPreview(undefined);
    setParseError("");
    setSnapshot((current) =>
      current ? { ...current, config: { ...current.config, scheduleFilePath: path } } : current
    );
  }

  async function handleScheduleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    applyPickedMarkdownFile(file.name, text);
    event.target.value = "";
  }

  async function handlePickScheduleFile() {
    if (!isDesktopRuntime()) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const picked = await pickMarkdownFile();
      if (picked) {
        applyPickedMarkdownFile(picked.path, picked.text);
      }
    } catch (error) {
      setParseError(`读取文件失败：${(error as Error).message}`);
    }
  }

  async function confirmAndExit() {
    const confirmed = window.confirm(
      "确认退出程序？\n\n当前状态会被保存，下次打开会继续恢复。\n退出程序不是暂停作息；只有突发事件会暂停作息时间。"
    );
    if (confirmed) {
      await requestExitApp();
    }
  }

  function enableTemplate(template = preview) {
    if (!template) {
      parseDraft();
      return;
    }
    const appliedTemplate = { ...template, appliedAt: toIso(new Date()) };
    const built = buildWorkdayFromTemplate(appliedTemplate, new Date());
    const nextSnapshot: AppSnapshot = {
      config: {
        ...createDefaultConfig(),
        scheduleFilePath: sourcePath || undefined,
        latestTemplateId: appliedTemplate.templateId,
        activeWorkdayId: built.state.workdayId
      },
      template: appliedTemplate,
      workdayState: built.state,
      stages: built.stages,
      timeline: built.timeline,
      incidents: [],
      events: [
        {
          id: `event_${Date.now()}`,
          type: "templateEnabled",
          occurredAt: toIso(new Date()),
          workdayId: built.state.workdayId,
          payload: { templateId: appliedTemplate.templateId }
        }
      ],
      reminderWindowVisible: built.state.pendingAction === "confirmStageStart"
    };
    setSnapshot(nextSnapshot);
    setView("today");
  }

  function dispatch(type: Parameters<typeof reduceSnapshot>[1]["type"]) {
    setSnapshot((current) => (current ? reduceSnapshot(current, { type, now: new Date() } as never) : current));
  }

  function handleReminderAction(action: ReminderAction) {
    setSnapshot((current) => (current ? reduceSnapshot(current, { type: action, now: new Date() } as never) : current));
    void hideReminderWindow();
  }

  function endIncident() {
    setSnapshot((current) =>
      current ? reduceSnapshot(current, { type: "endIncident", now: new Date(), note: incidentNote.trim() || undefined }) : current
    );
    setIncidentNote("");
  }

  function updateConfig(patch: Partial<AppConfig>) {
    setSnapshot((current) => (current ? { ...current, config: { ...current.config, ...patch } } : current));
  }

  function applyLatestSchedule() {
    if (!snapshot) return;
    try {
      const parsed = parseScheduleMarkdown(draftMarkdown, snapshot.config.scheduleFilePath);
      if (!window.confirm("应用最新日程会终止当前等待或进行中的阶段，并从当前时间重新定位。确认继续？")) return;
      const appliedTemplate = { ...parsed, appliedAt: toIso(new Date()) };
      const built = buildWorkdayFromTemplate(appliedTemplate, new Date());
      setSnapshot({
        ...snapshot,
        config: {
          ...snapshot.config,
          latestTemplateId: appliedTemplate.templateId,
          activeWorkdayId: built.state.workdayId
        },
        template: appliedTemplate,
        workdayState: built.state,
        stages: built.stages,
        timeline: built.timeline,
        events: [
          ...snapshot.events,
          {
            id: `event_${Date.now()}`,
            type: "scheduleApplied",
            occurredAt: toIso(new Date()),
            workdayId: built.state.workdayId,
            payload: { templateId: appliedTemplate.templateId }
          }
        ],
        incidents: []
      });
      setParseError("");
      setPreview(appliedTemplate);
    } catch (error) {
      setParseError(error instanceof ScheduleParseError ? error.message : (error as Error).message);
    }
  }

  if (!snapshot) {
    return (
      <main className="app-shell init-shell">
        <section className="init-panel">
          <div>
            <p className="eyebrow">首次启用</p>
            <h1>选择每日作息 Markdown</h1>
            <p className="muted">成功解析并启用前，不会启动提醒。当前阶段仍使用本地浏览器存储保存状态。</p>
          </div>
          <label className="field">
            <span>选择本地 Markdown 文件</span>
            <button type="button" className="secondary file-select-button" onClick={handlePickScheduleFile}>
              <FileText size={18} /> 选择 Markdown 文件
            </button>
            <input ref={fileInputRef} className="visually-hidden" type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={handleScheduleFileChange} />
          </label>
          {sourcePath && <p className="file-picked">已选择：{sourcePath}</p>}
          <label className="field">
            <span>Markdown 内容</span>
            <textarea value={draftMarkdown} onChange={(event) => setDraftMarkdown(event.target.value)} />
          </label>
          {parseError && <pre className="error-box">{parseError}</pre>}
          {preview && <TemplatePreview template={preview} />}
          <div className="button-row">
            <button className="secondary" onClick={parseDraft}>
              <FileText size={18} /> 解析预览
            </button>
            <button onClick={() => enableTemplate()} disabled={!preview}>
              <Upload size={18} /> 确认启用
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={handleScheduleFileChange} />
      <aside className="sidebar">
        <div className="brand">
          <Clock size={24} />
          <span>时间管理</span>
        </div>
        <button className={view === "today" ? "nav active" : "nav"} onClick={() => setView("today")}>
          <CalendarDays size={18} /> 今日
        </button>
        <button className={view === "history" ? "nav active" : "nav"} onClick={() => setView("history")}>
          <History size={18} /> 历史
        </button>
        <button className={view === "settings" ? "nav active" : "nav"} onClick={() => setView("settings")}>
          <Settings size={18} /> 设置
        </button>
      </aside>

      <section className="workspace">
        {snapshot.reminderWindowVisible && !isDesktopRuntime() && (
          <ReminderPanel
            snapshot={snapshot}
            currentStage={currentStage}
            onConfirmStart={() => dispatch("confirmStageStart")}
            onConfirmEnd={() => dispatch("confirmStageEnd")}
            onIncident={() => dispatch("startIncident")}
            onSnooze={() => dispatch("snoozeReminder")}
          />
        )}

        {view === "today" && (
          <>
            <StatusHeader snapshot={snapshot} stage={currentStage} now={now} />
            <ActionBar
              snapshot={snapshot}
              stage={currentStage}
              incidentNote={incidentNote}
              onIncidentNoteChange={setIncidentNote}
              onConfirmStart={() => dispatch("confirmStageStart")}
              onConfirmEnd={() => dispatch("confirmStageEnd")}
              onStartIncident={() => dispatch("startIncident")}
              onEndIncident={endIncident}
              onEarlyEnd={() => {
                if (window.confirm("确认提前结束当前阶段？后续阶段默认不会提前。")) dispatch("endStageEarly");
              }}
              onEnterNext={() => {
                if (window.confirm("确认立即进入下一阶段？后续时间线可能提前。")) dispatch("enterNextStageImmediately");
              }}
              onReset={() => {
                if (window.confirm("确认重置当前作息日？历史会保留，未完成阶段会被标记。")) dispatch("resetWorkday");
              }}
              onApplyLatest={() => setView("settings")}
              onExit={() => void confirmAndExit()}
            />
            <Timeline stages={snapshot.stages} segments={snapshot.timeline} now={now} />
          </>
        )}

        {view === "history" && <HistoryView snapshot={snapshot} />}
        {view === "settings" && (
          <SettingsView
            snapshot={snapshot}
            draftMarkdown={draftMarkdown}
            parseError={parseError}
            onDraftChange={setDraftMarkdown}
            onPickFile={handlePickScheduleFile}
            onConfigChange={updateConfig}
            onApplyLatest={applyLatestSchedule}
            onResetLocalData={() => {
              if (window.confirm("确认清空本地开发数据？")) {
                window.localStorage.clear();
                window.location.reload();
              }
            }}
          />
        )}
      </section>
    </main>
  );
}

function TemplatePreview({ template }: { template: ParsedTemplate }) {
  return (
    <div className="preview">
      <strong>解析成功：日程起点 {template.scheduleStart}</strong>
      <div className="preview-grid">
        {template.stages.map((stage) => (
          <span key={stage.index}>
            第 {stage.index} 段 {stage.startTime}-{stage.endTime} {stage.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatusHeader({ snapshot, stage, now }: { snapshot: AppSnapshot; stage?: StageInstance; now: Date }) {
  const state = snapshot.workdayState;
  return (
    <section className={`status-header status-${state.status}`}>
      <div>
        <p className="eyebrow">当前作息日</p>
        <h1>{formatWorkdayRange(snapshot)}</h1>
        <p className="muted">{state.message}</p>
      </div>
      <div className="status-metrics">
        <Metric label="状态" value={statusText(state.status)} />
        <Metric label="当前阶段" value={stage?.name ?? "无"} />
        <Metric label="下一步" value={pendingText(state.pendingAction)} />
        <Metric label="计时" value={activeTimerText(snapshot, stage, now)} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ActionBar(props: {
  snapshot: AppSnapshot;
  stage?: StageInstance;
  incidentNote: string;
  onIncidentNoteChange(value: string): void;
  onConfirmStart(): void;
  onConfirmEnd(): void;
  onStartIncident(): void;
  onEndIncident(): void;
  onEarlyEnd(): void;
  onEnterNext(): void;
  onReset(): void;
  onApplyLatest(): void;
  onExit(): void;
}) {
  const status = props.snapshot.workdayState.status;
  return (
    <section className="toolbar">
      <button onClick={props.onConfirmStart} disabled={status !== "waitingStageStart"}>
        <Play size={18} /> 确认开始
      </button>
      <button onClick={props.onConfirmEnd} disabled={status !== "waitingStageEnd"}>
        <Check size={18} /> 确认结束
      </button>
      <button onClick={props.onStartIncident} disabled={status === "incidentRunning" || status === "waitingNextWorkday"}>
        <PauseCircle size={18} /> 突发事件
      </button>
      <button onClick={props.onEarlyEnd} disabled={status !== "stageRunning"} className="secondary">
        <Square size={18} /> 提前结束
      </button>
      <button onClick={props.onEnterNext} disabled={status !== "idleGap" && status !== "waitingStageStart"} className="secondary">
        <RefreshCw size={18} /> 立即进入下一阶段
      </button>
      <button onClick={props.onReset} className="danger">
        <TimerReset size={18} /> 重置当前作息日
      </button>
      <button onClick={props.onApplyLatest} className="secondary">
        <FileText size={18} /> 应用最新日程
      </button>
      <button onClick={props.onExit} className="secondary">
        <Square size={18} /> 退出程序
      </button>
      {status === "incidentRunning" && (
        <div className="incident-end">
          <input value={props.incidentNote} onChange={(event) => props.onIncidentNoteChange(event.target.value)} placeholder="突发事件备注，可留空" />
          <button onClick={props.onEndIncident}>
            <Check size={18} /> 结束突发事件
          </button>
        </div>
      )}
    </section>
  );
}

function ReminderPanel(props: {
  snapshot: AppSnapshot;
  currentStage?: StageInstance;
  onConfirmStart(): void;
  onConfirmEnd(): void;
  onIncident(): void;
  onSnooze(): void;
}) {
  const pending = props.snapshot.workdayState.pendingAction;
  return (
    <aside className="reminder">
      <div>
        <p className="eyebrow">
          <Bell size={16} /> 提醒
        </p>
        <h2>{pending === "confirmStageEnd" ? "请确认阶段结束" : "请确认阶段开始"}</h2>
        <p>{props.currentStage?.name ?? "当前阶段"}</p>
      </div>
      <div className="button-row">
        {pending === "confirmStageStart" && (
          <button onClick={props.onConfirmStart}>
            <Play size={18} /> 确认开始
          </button>
        )}
        {pending === "confirmStageEnd" && (
          <button onClick={props.onConfirmEnd}>
            <Check size={18} /> 确认结束
          </button>
        )}
        <button className="secondary" onClick={props.onIncident}>
          <PauseCircle size={18} /> 突发事件
        </button>
        <button className="secondary" onClick={props.onSnooze}>
          <Bell size={18} /> 稍后提醒
        </button>
      </div>
    </aside>
  );
}

function ReminderWindowView({ snapshot, currentStage }: { snapshot?: AppSnapshot; currentStage?: StageInstance }) {
  const pending = snapshot?.workdayState.pendingAction;
  const isEnd = pending === "confirmStageEnd";
  const hasReminder = pending === "confirmStageStart" || pending === "confirmStageEnd";

  async function send(action: ReminderAction) {
    await sendReminderAction(action);
    if (action === "snoozeReminder") {
      await hideReminderWindow();
    }
  }

  return (
    <main className="reminder-window-shell">
      <section className="reminder-window">
        <p className="eyebrow">
          <Bell size={16} /> 时间管理提醒
        </p>
        {hasReminder ? (
          <>
            <div>
              <h1>{isEnd ? "请确认阶段结束" : "请确认阶段开始"}</h1>
              <p className="reminder-stage-name">{currentStage?.name ?? "当前阶段"}</p>
              <p className="muted">{snapshot?.workdayState.message}</p>
            </div>
            <div className="reminder-window-actions">
              {!isEnd && (
                <button onClick={() => void send("confirmStageStart")}>
                  <Play size={18} /> 确认开始
                </button>
              )}
              {isEnd && (
                <>
                  <button onClick={() => void send("confirmStageEnd")}>
                    <Check size={18} /> 确认结束
                  </button>
                  <button className="secondary" onClick={() => void send("continueCurrentStage")}>
                    <RefreshCw size={18} /> 继续当前阶段
                  </button>
                </>
              )}
              <button className="secondary" onClick={() => void send("startIncident")}>
                <PauseCircle size={18} /> 突发事件
              </button>
              <button className="secondary" onClick={() => void send("snoozeReminder")}>
                <Bell size={18} /> 稍后提醒
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h1>暂无待确认提醒</h1>
              <p className="muted">当前没有需要处理的阶段开始或结束确认。</p>
            </div>
            <div className="reminder-window-actions">
              <button onClick={() => void showMainWindow()}>
                <CalendarDays size={18} /> 打开主界面
              </button>
              <button className="secondary" onClick={() => void hideReminderWindow()}>
                <Bell size={18} /> 隐藏
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function Timeline({ stages, segments, now }: { stages: StageInstance[]; segments: TimelineSegment[]; now: Date }) {
  return (
    <section className="timeline-wrap">
      <div className="section-title">
        <h2>今日时间线</h2>
        <span>{segments.length} 个片段</span>
      </div>
      <div className="timeline">
        {stages.map((stage) => (
          <article className={`stage-card stage-${stage.status}`} key={stage.id}>
            <div>
              <span className="stage-index">第 {stage.templateStageIndex} 段</span>
              <h3>{stage.name}</h3>
              {stage.note && <p className="muted">{stage.note}</p>}
            </div>
            <div className="time-grid">
              <span>原计划：{formatClock(stage.originalStart)}-{formatClock(stage.originalEnd)}</span>
              <span>
                当前计划：{formatClock(stage.currentStart)}-{formatClock(stage.currentEnd)} {planDeltaText(stage)}
              </span>
              <span>实际：{actualText(stage, now)}</span>
              <span>状态：{stageStatusText(stage.status)}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function HistoryView({ snapshot }: { snapshot: AppSnapshot }) {
  return (
    <section className="content-panel">
      <div className="section-title">
        <h2>历史记录</h2>
        <span>按作息日归档，只读</span>
      </div>
      <div className="history-list">
        {snapshot.timeline.map((segment) => (
          <article key={segment.id} className="history-item">
            <strong>{segment.name}</strong>
            <span>{segmentTypeText(segment.type)}</span>
            <span>
              {formatClock(segment.start)}-{formatClock(segment.end)}
            </span>
            {segment.note && <p>{segment.note}</p>}
          </article>
        ))}
      </div>
      <div className="section-title">
        <h2>事件流</h2>
        <span>{snapshot.events.length} 条事件</span>
      </div>
      <div className="event-list">
        {snapshot.events.map((event) => (
          <span key={event.id}>
            {formatClock(event.occurredAt)} · {event.type}
          </span>
        ))}
      </div>
    </section>
  );
}

function SettingsView(props: {
  snapshot: AppSnapshot;
  draftMarkdown: string;
  parseError: string;
  onDraftChange(value: string): void;
  onPickFile(): void;
  onConfigChange(patch: Partial<AppConfig>): void;
  onApplyLatest(): void;
  onResetLocalData(): void;
}) {
  const config = props.snapshot.config;
  return (
    <section className="content-panel settings-grid">
      <label className="field">
        <span>选择最新 Markdown 文件</span>
        <button type="button" className="secondary file-select-button" onClick={props.onPickFile}>
          <FileText size={18} /> 选择 Markdown 文件
        </button>
      </label>
      <div className="file-picked">当前文件：{config.scheduleFilePath ?? "未记录文件名"}</div>
      <label className="field">
        <span>提醒间隔</span>
        <select
          value={config.reminderIntervalMinutes}
          onChange={(event) => props.onConfigChange({ reminderIntervalMinutes: Number(event.target.value) })}
        >
          {[1, 3, 5, 10, 15].map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} 分钟
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>声音模式</span>
        <select value={config.soundMode} onChange={(event) => props.onConfigChange({ soundMode: event.target.value as AppConfig["soundMode"] })}>
          <option value="everyReminder">每次周期提醒都响</option>
          <option value="firstOnly">仅首次响</option>
          <option value="silent">静音</option>
        </select>
      </label>
      <div className="settings-status">
        <span>系统通知状态</span>
        <strong>{notificationStatusText(props.snapshot.notificationStatus)}</strong>
      </div>
      <label className="toggle">
        <input type="checkbox" checked={config.autostart} onChange={(event) => props.onConfigChange({ autostart: event.target.checked })} />
        <span>开机自启动</span>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={config.mainWindowAlwaysOnTop}
          onChange={(event) => props.onConfigChange({ mainWindowAlwaysOnTop: event.target.checked })}
        />
        <span>主窗口置顶</span>
      </label>
      <div className="notice">
        <AlertTriangle size={18} />
        提醒窗口、系统通知和声音提醒已接入；SQLite 和开机自启动将在后续阶段接入。
      </div>
      <label className="field full">
        <span>最新 Markdown 内容</span>
        <textarea value={props.draftMarkdown} onChange={(event) => props.onDraftChange(event.target.value)} />
      </label>
      {props.parseError && <pre className="error-box full">{props.parseError}</pre>}
      <div className="button-row full">
        <button onClick={props.onApplyLatest}>
          <RefreshCw size={18} /> 应用最新日程
        </button>
        <button className="danger" onClick={props.onResetLocalData}>
          <TimerReset size={18} /> 清空本地开发数据
        </button>
      </div>
    </section>
  );
}

function formatWorkdayRange(snapshot: AppSnapshot): string {
  const start = snapshot.workdayState.workdayStart;
  const end = snapshot.workdayState.workdayEnd;
  if (!start || !end) return "未建立作息日";
  return `${new Date(start).toLocaleDateString("zh-CN")} ${formatClock(start)} - ${new Date(end).toLocaleDateString("zh-CN")} ${formatClock(end)}`;
}

function activeTimerText(snapshot: AppSnapshot, stage: StageInstance | undefined, now: Date): string {
  const status = snapshot.workdayState.status;
  if (status === "incidentRunning") {
    const incident = snapshot.incidents.find((item) => item.id === snapshot.workdayState.currentIncidentId);
    return incident ? `突发事件 ${formatDuration((now.getTime() - new Date(incident.startedAt).getTime()) / 1000)}` : "突发事件中";
  }
  if (!stage) return "无";
  if (status === "stageRunning") {
    return `剩余 ${formatDuration((new Date(stage.currentEnd).getTime() - now.getTime()) / 1000)}`;
  }
  if (status === "waitingStageStart") {
    return `已等待 ${Math.max(0, minutesBetween(new Date(stage.currentStart), now))} 分钟`;
  }
  if (status === "waitingStageEnd") {
    return `已超时 ${Math.max(0, minutesBetween(new Date(stage.currentEnd), now))} 分钟`;
  }
  return "无";
}

function planDeltaText(stage: StageInstance): string {
  const delta = minutesBetweenIso(stage.originalStart, stage.currentStart);
  if (delta > 0) return `，延后 ${delta} 分钟`;
  if (delta < 0) return `，提前 ${Math.abs(delta)} 分钟`;
  return "";
}

function actualText(stage: StageInstance, now: Date): string {
  if (stage.terminated) return `已终止：${stage.terminationReason ?? ""}`;
  if (stage.actualStart && stage.actualEnd) return `${formatClock(stage.actualStart)}-${formatClock(stage.actualEnd)}${stage.endedEarly ? "，已提前结束" : ""}`;
  if (stage.actualStart) return `${formatClock(stage.actualStart)}-进行中`;
  if (stage.status === "waitingStart") return `等待确认，已等待 ${Math.max(0, minutesBetween(new Date(stage.currentStart), now))} 分钟`;
  return "未开始";
}

function statusText(status: WorkdayStatus): string {
  const map: Record<WorkdayStatus, string> = {
    uninitialized: "未初始化",
    waitingWorkdayStart: "等待作息日开始",
    idleGap: "自动空档中",
    waitingStageStart: "等待阶段开始确认",
    stageRunning: "阶段进行中",
    waitingStageEnd: "等待阶段结束确认",
    incidentRunning: "突发事件中",
    waitingNextWorkday: "等待下一个作息日",
    dataError: "数据错误"
  };
  return map[status];
}

function stageStatusText(status: StageInstance["status"]): string {
  const map: Record<StageInstance["status"], string> = {
    notStarted: "未开始",
    waitingStart: "等待开始确认",
    running: "进行中",
    waitingEnd: "等待结束确认",
    completed: "已完成",
    terminated: "已终止",
    abandoned: "已放弃"
  };
  return map[status];
}

function pendingText(action?: string): string {
  if (action === "confirmStageStart") return "确认开始";
  if (action === "confirmStageEnd") return "确认结束";
  if (action === "endIncident") return "结束突发事件";
  return "无";
}

function notificationStatusText(status?: AppSnapshot["notificationStatus"]): string {
  if (status === "granted") return "可用";
  if (status === "denied") return "被拒绝";
  if (status === "unavailable") return "不可用";
  return "未知";
}

function segmentTypeText(type: TimelineSegment["type"]): string {
  const map: Record<TimelineSegment["type"], string> = {
    stage: "正式阶段",
    autoGap: "自动空档",
    earlyEndGap: "提前结束空档",
    incident: "突发事件",
    manualReset: "手动重置",
    applySchedule: "应用新日程"
  };
  return map[type];
}
