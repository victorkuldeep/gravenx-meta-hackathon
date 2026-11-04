"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchCreateMeta } from "@/lib/pmo/jira";
import { getPmoConnection, hasPmoCredentials, setPmoConnection } from "@/lib/pmo/jiraVault";
import { probeSnowTable } from "@/lib/pmo/snow";
import { getSnowConnection, hasSnowCredentials, setSnowConnection } from "@/lib/pmo/snowVault";
import {
  forgetPmoSecret,
  isPmoUnlocked,
  listPmoSaved,
  lockPmo,
  revealPmoSecret,
  savePmoSecret,
  unlockPmo,
  type SavedPmoCredential,
} from "@/lib/pmo/secureStore";

const inputCls =
  "w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px] placeholder:text-ivory-400";

function StatusDot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-bold">
      <span className={`h-2 w-2 rounded-full ${on ? "bg-emerald-600" : "bg-ivory-300"}`} aria-hidden="true" />
      <span className={on ? "text-emerald-700" : "text-ivory-500"}>{label}</span>
    </span>
  );
}

/**
 * Setup → Delivery: Jira + ServiceNow in one place. Session-only connect
 * stays the default; remembering is opt-in, AES-GCM encrypted with a
 * passphrase-derived key that never leaves memory. Unlocking hydrates the
 * session vaults, so Console, Arena and the AI agent work immediately.
 */
export function PmoConnectionsPanel() {
  const [jira, setJira] = useState({ site: "", email: "", token: "" });
  const [snow, setSnow] = useState({ instance: "", user: "", pass: "" });
  const [pass, setPass] = useState("");
  const [saved, setSaved] = useState<SavedPmoCredential[]>([]);
  const [unlocked, setUnlocked] = useState(false);
  const [jiraOn, setJiraOn] = useState(false);
  const [snowOn, setSnowOn] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ system: string; ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const jc = getPmoConnection();
      setJiraOn(hasPmoCredentials(jc));
      setJira((p) => ({ site: p.site || jc.site, email: p.email || jc.email, token: p.token || jc.token }));
    } catch {
      setJiraOn(false);
    }
    try {
      const sc = getSnowConnection();
      setSnowOn(hasSnowCredentials(sc));
      setSnow((p) => ({ instance: p.instance || sc.instance, user: p.user || sc.user, pass: p.pass || sc.pass }));
    } catch {
      setSnowOn(false);
    }
    setUnlocked(isPmoUnlocked());
    setSaved(await listPmoSaved());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const say = (system: string, ok: boolean, text: string) => setMsg({ system, ok, text });

  const hydrateFromSaved = useCallback(async () => {
    for (const row of await listPmoSaved()) {
      try {
        const secret = await revealPmoSecret(row.system);
        if (row.system === "jira") setPmoConnection({ site: row.site, email: row.login, token: secret });
        else setSnowConnection({ instance: row.site, user: row.login, pass: secret });
      } catch {
        /* wrong passphrase or unreadable row - status panel says so */
      }
    }
  }, []);

  const doUnlock = async () => {
    if (!pass) {
      say("pmo", false, "Enter a passphrase to unlock.");
      return;
    }
    setBusy("unlock");
    try {
      await unlockPmo(pass);
      await hydrateFromSaved();
      setPass("");
      say("pmo", true, "Unlocked - remembered logins are live this tab.");
    } catch (e) {
      say("pmo", false, e instanceof Error ? e.message : "Unlock failed.");
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const testJira = async () => {
    setBusy("test-jira");
    setMsg(null);
    try {
      const list = await fetchCreateMeta({ site: jira.site.trim(), email: jira.email.trim(), token: jira.token });
      say("jira", true, `Connected - ${list.length} creatable project${list.length === 1 ? "" : "s"} visible.`);
    } catch (e) {
      say("jira", false, e instanceof Error ? e.message : "Jira test failed.");
    } finally {
      setBusy(null);
    }
  };

  const testSnow = async () => {
    setBusy("test-snow");
    setMsg(null);
    try {
      const probe = await probeSnowTable({ instance: snow.instance.trim(), user: snow.user.trim(), pass: snow.pass }, "incident");
      say("snow", true, `Connected - table ${probe.table} readable (${probe.sampleFields.length} sampled fields).`);
    } catch (e) {
      say("snow", false, e instanceof Error ? e.message : "ServiceNow test failed.");
    } finally {
      setBusy(null);
    }
  };

  const connectSession = (system: "jira" | "snow") => {
    if (system === "jira") {
      setPmoConnection({ site: jira.site, email: jira.email, token: jira.token });
      say("jira", true, "Connected for this tab only - dies with the tab.");
    } else {
      setSnowConnection({ instance: snow.instance, user: snow.user, pass: snow.pass });
      say("snow", true, "Connected for this tab only - dies with the tab.");
    }
    void refresh();
  };

  const remember = async (system: "jira" | "snow") => {
    setBusy(`remember-${system}`);
    setMsg(null);
    try {
      if (!isPmoUnlocked()) {
        if (!pass) throw new Error("Enter a passphrase first - it encrypts what gets remembered.");
        await unlockPmo(pass);
      }
      if (system === "jira") {
        if (!jira.site.trim() || !jira.email.trim() || !jira.token) throw new Error("Site, email and token are all required.");
        await savePmoSecret("jira", jira.site.trim(), jira.email.trim(), jira.token);
        setPmoConnection({ site: jira.site, email: jira.email, token: jira.token });
      } else {
        if (!snow.instance.trim() || !snow.user.trim() || !snow.pass) throw new Error("Instance, user and password are all required.");
        await savePmoSecret("snow", snow.instance.trim(), snow.user.trim(), snow.pass);
        setSnowConnection({ instance: snow.instance, user: snow.user, pass: snow.pass });
      }
      setPass("");
      say(system, true, "Remembered encrypted in this browser - unlock once per tab from now on.");
    } catch (e) {
      say(system, false, e instanceof Error ? e.message : "Remember failed.");
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const forget = async (system: "jira" | "snow") => {
    setBusy(`forget-${system}`);
    try {
      await forgetPmoSecret(system);
      say(system, true, "Forgotten - the encrypted row is gone. This tab stays connected until reload.");
    } catch (e) {
      say(system, false, e instanceof Error ? e.message : "Forget failed.");
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const savedFor = (system: "jira" | "snow") => saved.find((r) => r.system === system);

  const card = (
    system: "jira" | "snow",
    title: string,
    hint: string,
    fields: { key: string; label: string; value: string; secret?: boolean; set: (v: string) => void }[],
    on: boolean,
    onTest: () => void,
    testBusy: boolean
  ) => {
    const row = savedFor(system);
    return (
      <div className="arch-card overflow-hidden">
        <div className="arch-card__head flex items-center gap-2 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ivory-950">{title}</p>
            {hint ? <p className="mt-0.5 text-[11px] text-ivory-600">{hint}</p> : null}
          </div>
          <StatusDot on={on} label={on ? "Connected" : "Not connected"} />
        </div>
        <div className="space-y-2 px-4 py-3">
          {row && (
            <p className={`text-[12px] ${unlocked ? "text-emerald-700" : "text-amber-700"}`}>
              Remembered {row.login} @ {row.site} · {unlocked ? "unlocked" : "locked"}
              {!unlocked && " - unlock above to use it"}
            </p>
          )}
          {fields.map((f) => (
            <input
              key={f.key}
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              placeholder={f.label}
              type={f.secret ? "password" : "text"}
              spellCheck={false}
              autoComplete="off"
              aria-label={f.label}
              className={inputCls}
            />
          ))}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={onTest}
              disabled={testBusy || busy !== null}
              className="cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[12px] font-semibold hover:bg-ivory-50 disabled:opacity-50"
            >
              {testBusy ? "Testing…" : "Test connection"}
            </button>
            <button
              type="button"
              onClick={() => connectSession(system)}
              className="cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[12px] font-semibold hover:bg-ivory-50"
            >
              Connect (this tab)
            </button>
            <button
              type="button"
              onClick={() => void remember(system)}
              disabled={busy === `remember-${system}`}
              title="AES-GCM encrypted with your passphrase - survives reload after unlock"
              className="cursor-pointer rounded-lg bg-ivory-950 px-2.5 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
            >
              {busy === `remember-${system}` ? "Saving…" : "Remember encrypted"}
            </button>
            {row && (
              <button
                type="button"
                onClick={() => void forget(system)}
                disabled={busy === `forget-${system}`}
                className="cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[12px] hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
              >
                Forget
              </button>
            )}
          </div>
          {msg?.system === system && <p className={`text-[12px] ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="arch-card overflow-hidden">
        <div className="arch-card__head px-4 py-2.5">
          <p className="text-sm font-bold text-ivory-950">Browser key</p>
          <p className="mt-0.5 text-[11px] text-ivory-600">
            One passphrase encrypts every remembered login. It never leaves memory - reload locks everything again.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <input
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doUnlock();
            }}
            placeholder={unlocked ? "Unlocked - passphrase clears on use" : "Passphrase to unlock remembered logins"}
            type="password"
            spellCheck={false}
            autoComplete="off"
            aria-label="Encryption passphrase"
            className={`${inputCls} max-w-xs`}
          />
          {!unlocked ? (
            <button
              type="button"
              onClick={() => void doUnlock()}
              disabled={busy === "unlock"}
              className="cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
            >
              {busy === "unlock" ? "Unlocking…" : "Unlock"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                lockPmo();
                setPass("");
                void refresh();
              }}
              className="cursor-pointer rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[12px] font-semibold hover:bg-ivory-50"
            >
              Lock
            </button>
          )}
          <StatusDot on={unlocked} label={unlocked ? "Unlocked" : "Locked"} />
          {msg?.system === "pmo" && <p className={`w-full text-[12px] ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
        </div>
      </div>

      {card(
        "jira",
        "Jira",
        "Console tasks, Arena sessions and the AI agent push here.",
        [
          { key: "site", label: "acme.atlassian.net", value: jira.site, set: (v) => setJira((p) => ({ ...p, site: v })) },
          { key: "email", label: "you@company.com", value: jira.email, set: (v) => setJira((p) => ({ ...p, email: v })) },
          { key: "token", label: "API token", value: jira.token, secret: true, set: (v) => setJira((p) => ({ ...p, token: v })) },
        ],
        jiraOn,
        testJira,
        busy === "test-jira"
      )}

      {card(
        "snow",
        "ServiceNow",
        "Incidents, tasks and stories from Console - same session posture.",
        [
          { key: "instance", label: "acme.service-now.com", value: snow.instance, set: (v) => setSnow((p) => ({ ...p, instance: v })) },
          { key: "user", label: "Username", value: snow.user, set: (v) => setSnow((p) => ({ ...p, user: v })) },
          { key: "pass", label: "Password", value: snow.pass, secret: true, set: (v) => setSnow((p) => ({ ...p, pass: v })) },
        ],
        snowOn,
        testSnow,
        busy === "test-snow"
      )}
    </div>
  );
}
