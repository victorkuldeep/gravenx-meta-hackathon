"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  SalesforceObject,
  SalesforceField,
  SalesforceDescribeResult,
  GeneratedPayload,
  OperationType,
} from "@/lib/salesforce/types";
import { generatePayload, generateEndpoint } from "@/lib/payload/generator";
import { generateSampleValues, getSampleValueForField } from "@/lib/payload/samples";
import { getWritableFields, isRequiredField } from "@/lib/salesforce/metadata";
import { isSessionExpiredMessage } from "@/lib/salesforce/client";
import { apiFetch } from "@/lib/api";
import { getPreferences } from "@/lib/setup/preferences";
import { builderGridClass } from "@/lib/builder/panels";
import { BuilderRail } from "@/components/BuilderRail";
import { ExplorerPanel } from "@/components/ExplorerPanel";
import { AppShell } from "@/components/layout/AppShell";
import { Stepper } from "@/components/Stepper";
import { WelcomeModal } from "@/components/WelcomeModal";
import { HowItWorksModal } from "@/components/HowItWorksModal";
import { SessionExpiredModal } from "@/components/SessionExpiredModal";
import { BootLoader } from "@/components/BootLoader";
import { CollectionDrawer } from "@/components/CollectionDrawer";
import { CollectionTrayButton } from "@/components/CollectionTrayButton";
import { CollectionPicker } from "@/components/CollectionPicker";
import { HomeZigZag, type ZigZagTarget } from "@/components/HomeZigZag";
import { PrivacyBanner } from "@/components/PrivacyBanner";
import { useRouter } from "next/navigation";
import type { Collection, CollectionItem, NewCollectionItem } from "@/lib/collection/types";
import { newItemId } from "@/lib/collection/types";
import {
  listCollectionItems,
  saveCollectionItem,
  deleteCollectionItem,
  listCollections,
  saveCollection,
  deleteCollection as deleteCollectionFromDb,
} from "@/lib/collection/db";
import { ConnectModal } from "@/components/ConnectModal";
import { ObjectSearchOverlay } from "@/components/ObjectSearchOverlay";
import { getCachedConnection, setCachedConnection, clearCachedConnection } from "@/lib/session/cache";
import { clearSessionExpired, markSessionExpired } from "@/lib/ai/gate";
import { loadAutosave, queueAutosave, flushAutosaves, clearAutosave, migrateLegacyWorkspace } from "@/lib/workspace/autosave";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { SchemaNavRequest } from "@/components/SchemaPanel";
import { useDeepParam } from "@/lib/deep/deep";
import ObjectPanel from "@/components/ObjectPanel";
import FieldPanel from "@/components/FieldPanel";
import PayloadPanel from "@/components/PayloadPanel";
import ExportPanel from "@/components/ExportPanel";
import RequestPanel from "@/components/RequestPanel";
import CompositePanel from "@/components/CompositePanel";
import GraphQLPanel from "@/components/GraphQLPanel";
import SoqlPanel from "@/components/SoqlPanel";
import RestExplorerPanel from "@/components/RestExplorerPanel";
import { ApexPanel } from "@/components/ApexPanel";
import { EventMonitorPanel } from "@/components/EventMonitorPanel";
import { WebhooksPanel } from "@/components/WebhooksPanel";
import dynamic from "next/dynamic";

// Schema canvas loads on demand: keeps the main bundle lean and the
// static-generation worker light (xyflow + dagre stay out of SSR).
const SchemaPanel = dynamic(() => import("@/components/SchemaPanel"), {
  ssr: false,
  loading: () => (
    <div className="arch-card px-6 py-12 text-center text-sm text-ivory-600">
      Loading schema canvas…
    </div>
  ),
});

type BuilderMode = "home" | "single" | "composite" | "soql" | "graphql" | "schema" | "rest" | "apex" | "events" | "webhooks" | "explore";



interface AppState {
  connected: boolean;
  instanceUrl: string;
  token: string;
  apiVersion: string;
  mode: BuilderMode;
  objectCount: number;
  objects: SalesforceObject[];
  selectedObject: SalesforceObject | null;
  describe: SalesforceDescribeResult | null;
  selectedFieldNames: Set<string>;
  fieldValues: Record<string, unknown>;
  operation: OperationType;
  recordId: string;
  generatedPayload: GeneratedPayload | null;
}

const initialState: AppState = {
  connected: false,
  instanceUrl: "",
  token: "",
  apiVersion: defaultApiVersion(),
  mode: "home",
  objectCount: 0,
  objects: [],
  selectedObject: null,
  describe: null,
  selectedFieldNames: new Set(),
  fieldValues: {},
  operation: "POST",
  recordId: "",
  generatedPayload: null,
};

// ── Builder request tabs: up to 10 full drafts side by side, mirroring the
// Composite bundle pattern. Each tab owns object + fields + values +
// operation + generated payload + test result (RequestPanel keeps its own
// send state per mounted tab switch via key).
interface BuilderDraft {
  selectedObject: SalesforceObject | null;
  describe: SalesforceDescribeResult | null;
  selectedFieldNames: Set<string>;
  fieldValues: Record<string, unknown>;
  operation: OperationType;
  recordId: string;
  generatedPayload: GeneratedPayload | null;
}

interface BuilderTab {
  tabId: string;
  name: string | null;
  draft: BuilderDraft;
}

const MAX_BUILDER_TABS = 10;

// ── Schema canvas tabs: each tab is a full SchemaPanel instance (own memory,
// own autosave slices, own restore). Snapshots stay shared across tabs.
interface SchemaTab {
  tabId: string;
  name: string;
}

const MAX_SCHEMA_TABS = 5;

const freshBuilderDraft = (): BuilderDraft => ({
  selectedObject: null,
  describe: null,
  selectedFieldNames: new Set(),
  fieldValues: {},
  operation: "POST",
  recordId: "",
  generatedPayload: null,
});

interface LoadingState {
  connect: boolean;
  objects: boolean;
  describe: boolean;
}

interface ErrorState {
  connect: string | null;
  objects: string | null;
  describe: string | null;
}

const SINGLE_STEPS = [
  { label: "Connect", hint: "Org + token" },
  { label: "Select", hint: "Object + fields" },
  { label: "Configure", hint: "Values + op" },
  { label: "Export", hint: "Payload + test" },
];

const COMPOSITE_STEPS = [
  { label: "Connect", hint: "Org + token" },
  { label: "Compose", hint: "Subrequests" },
  { label: "Send", hint: "One call" },
];

const SOQL_STEPS = [
  { label: "Connect", hint: "Org + token" },
  { label: "Query", hint: "SOQL + plan" },
  { label: "Export", hint: "CSV + JSON" },
];

const SOSL_STEPS = [
  { label: "Connect", hint: "Org + token" },
  { label: "Search", hint: "SOSL + grid" },
  { label: "Export", hint: "CSV + JSON" },
];

const REST_STEPS = [
  { label: "Connect", hint: "Org + token" },
  { label: "Explore", hint: "Any method" },
  { label: "Export", hint: "Collect" },
];

const GRAPHQL_STEPS = [
  { label: "Connect", hint: "Org + token" },
  { label: "Query", hint: "Object + fields" },
  { label: "Run", hint: "Read-only" },
];

/**
 * Connect default: deploy-time env wins, then the Setup preference,
 * then the code fallback. Read at call time so a preference change
 * applies to the next connection without a reload.
 */
function defaultApiVersion(): string {
  return process.env.NEXT_PUBLIC_DEFAULT_SF_API_VERSION ?? getPreferences().defaultApiVersion;
}

function readSavedCreds() {
  try {
    const saved = sessionStorage.getItem("gravenx_session");
    if (saved) {
      const parsed = JSON.parse(saved) as {
        instanceUrl?: string;
        token?: string;
        apiVersion?: string;
      };
      return {
        instanceUrl: parsed.instanceUrl ?? "",
        token: parsed.token ?? "",
        apiVersion: parsed.apiVersion ?? defaultApiVersion(),
      };
    }
  } catch {
    /* ignore */
  }
  return { instanceUrl: "", token: "", apiVersion: defaultApiVersion() };
}

/**
 * Smooth-scroll to a section and pulse a bronze ring around it,
 * so nav clicks give visible feedback even when the target is already in view.
 */
function scrollToSection(id: string, updateHash: boolean): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.remove("flash-target");
  void el.offsetWidth; // restart the animation on repeat clicks
  el.classList.add("flash-target");
  window.setTimeout(() => el.classList.remove("flash-target"), 1900);
  if (updateHash) history.replaceState(null, "", `#${id}`);
  return true;
}

/**
 * The home hero - identical offline and online (post-login it just swaps
 * the primary CTA to Switch org). Headline, artwork, trio cards.
 */
/** Standalone routes the hero carousel can land on directly (no org needed to look). */
const HERO_ROUTES = ["system", "sequence", "wireframe", "draw", "arena", "log-decomposer"] as const;
type HeroMode = Exclude<BuilderMode, "home"> | "json" | "contracts" | (typeof HERO_ROUTES)[number];

function isHeroRoute(mode: HeroMode): mode is (typeof HERO_ROUTES)[number] {
  return (HERO_ROUTES as readonly string[]).includes(mode);
}

const HERO_SLIDES: {
  eyebrow: string;
  titleA: string;
  titleEm: string;
  copy: string;
  cta: string;
  mode: HeroMode;
}[] = [
  {
    eyebrow: "Org data-model explorer",
    titleA: "Every object,",
    titleEm: "every field, one table.",
    copy: "Walk standard, custom, settings, metadata and big objects in a searchable grid - relationships and Excel export included.",
    cta: "Explore",
    mode: "explore",
  },
  {
    eyebrow: "Metadata-driven payload builder",
    titleA: "From live metadata to",
    titleEm: "ready-to-send payloads.",
    copy: "Describe any standard or custom sObject and mint accurate POST / PATCH bodies - type-correct, required-aware, exportable everywhere.",
    cta: "Single Object",
    mode: "single",
  },
  {
    eyebrow: "Composite Studio",
    titleA: "Requests, graph,",
    titleEm: "payload.",
    copy: "Compose multi-sObject batches with unique reference IDs - one model, three views, zero hand-written JSON.",
    cta: "Composite",
    mode: "composite",
  },
  {
    eyebrow: "SOQL query engine",
    titleA: "Ask anything,",
    titleEm: "explain everything.",
    copy: "Plans, history, saved queries and CSV exports - Dev Console power without leaving the studio.",
    cta: "SOQL",
    mode: "soql",
  },
  {
    eyebrow: "GraphQL query builder",
    titleA: "One round trip,",
    titleEm: "whole graph.",
    copy: "Walk lookup trees with value precision. Live metadata, read-only, no mutations.",
    cta: "GraphQL",
    mode: "graphql",
  },
  {
    eyebrow: "Schema deep dive",
    titleA: "See the model,",
    titleEm: "not just the fields.",
    copy: "Traverse any org as an ERD - discover relationships, present with the laser, export hi-res PNG.",
    cta: "Schema Map",
    mode: "schema",
  },
  {
    eyebrow: "Raw REST explorer",
    titleA: "Any method,",
    titleEm: "any endpoint.",
    copy: "Org-scoped or public calls with cURL paste, history and one-click collection staging.",
    cta: "REST",
    mode: "rest",
  },
  {
    eyebrow: "Anonymous Apex runner",
    titleA: "Run code,",
    titleEm: "no deployment.",
    copy: "Execute Apex against the connected org - compile errors, exceptions and debug logs inline.",
    cta: "Apex",
    mode: "apex",
  },
  {
    eyebrow: "Live event monitor",
    titleA: "Watch events",
    titleEm: "as they happen.",
    copy: "Subscribe to platform events, CDC and push topics - replay, filter and copy the live stream.",
    cta: "Events",
    mode: "events",
  },
  {
    eyebrow: "JSON Studio",
    titleA: "Diff payloads,",
    titleEm: "node by node.",
    copy: "Edit JSON in a tree and compare versions side by side - virtualized for the biggest payloads.",
    cta: "JSON",
    mode: "json",
  },
  {
    eyebrow: "API Contract Studio",
    titleA: "Design contracts,",
    titleEm: "ship OpenAPI.",
    copy: "Author profiles, map fields, compile deterministic OpenAPI 3.1 - versions and compatibility included.",
    cta: "Contracts",
    mode: "contracts",
  },
  {
    eyebrow: "Live webhook inbox",
    titleA: "Inbound traffic,",
    titleEm: "caught live.",
    copy: "Register an inbox, paste the URL into remote-site settings - inspect headers and payloads as they arrive.",
    cta: "Webhooks",
    mode: "webhooks",
  },
  {
    eyebrow: "System Design workbench",
    titleA: "Design the topology,",
    titleEm: "run it live.",
    copy: "Drag systems on canvas, wire GET/POST flows with transforms and mocks, simulate end to end and export the run.",
    cta: "System",
    mode: "system",
  },
  {
    eyebrow: "Sequence studio",
    titleA: "Describe the interaction,",
    titleEm: "see the architecture.",
    copy: "Write a few lines - participants, calls, loops, retries - and get timing-aware diagrams with PNG export.",
    cta: "Sequence",
    mode: "sequence",
  },
  {
    eyebrow: "Wireframe Studio",
    titleA: "Screens that understand",
    titleEm: "your schema.",
    copy: "Compose structured UI bound to live Salesforce fields, flag proposed fields, and ship build-ready specs.",
    cta: "Wireframe",
    mode: "wireframe",
  },
  {
    eyebrow: "Engineering whiteboard",
    titleA: "Think on canvas,",
    titleEm: "keep every stroke.",
    copy: "Excalidraw-powered boards with libraries, snapshots and PNG export - autosaved per drawing.",
    cta: "Draw+",
    mode: "draw",
  },
  {
    eyebrow: "Design Arena",
    titleA: "Argue the design",
    titleEm: "before building it.",
    copy: "Agentic architecture sessions - ground the brain, debate in rounds, attach decisions back to Jira.",
    cta: "Arena",
    mode: "arena",
  },
  {
    eyebrow: "Log Decomposer",
    titleA: "Don't read the log.",
    titleEm: "Explore the execution.",
    copy: "Capture debug logs, walk the execution tree and timeline, and prove the cause with evidence-backed RCA.",
    cta: "Decompose",
    mode: "log-decomposer",
  },
];

function HomeHero({
  connected,
  loadingConnect,
  connectError,
  onConnect,
  onHowItWorks,
  onJumpMode,
}: {
  connected: boolean;
  loadingConnect: boolean;
  connectError: string | null;
  onConnect: () => void;
  onHowItWorks: () => void;
  onJumpMode: (m: HeroMode) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const t = window.setInterval(() => setIdx((i) => (i + 1) % HERO_SLIDES.length), 15000);
    return () => window.clearInterval(t);
  }, [paused]);

  const slide = HERO_SLIDES[idx];
  const HERO_IMAGES = [
    { src: "/hero/builder-home.webp", alt: "Single-object payload builder" },
    { src: "/hero/api-studio.webp", alt: "Composite API studio" },
    { src: "/hero/graphql.webp", alt: "GraphQL query builder" },
    { src: "/hero/schema-studio.webp", alt: "Schema ERD studio" },
    { src: "/hero/json-workbench.webp", alt: "JSON workbench comparator" },
  ];
  const heroImgIdx = idx % HERO_IMAGES.length;

  return (
    <section
      aria-label="Welcome"
      aria-roledescription="carousel"
      className="hero-mesh overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="grid items-stretch gap-6 pt-5 pb-8 lg:grid-cols-[1fr_1.35fr]">
        {/* Fixed frame - text moves inside, page length never shifts */}
        <div key={idx} className="hero-slide min-h-[540px] flex flex-col justify-center">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[var(--color-canvas)] border border-[var(--color-line)] text-[11px] font-mono uppercase tracking-wider text-[var(--color-accent-dark)] font-medium">
              {slide.eyebrow}
            </span>
            <span className="text-[10px] font-mono text-[var(--color-muted)] px-2 py-0.5 rounded bg-[var(--color-surface-strong)] border border-[var(--color-line-soft)]">
              {idx + 1} of {HERO_SLIDES.length}
            </span>
          </div>
          <h1 className="hero-title hero-title--red mt-3 text-ivory-950">
            {slide.titleA} <em>{slide.titleEm}</em>
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ivory-700">
            {slide.copy}
          </p>
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={() => onJumpMode(slide.mode)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-accent)] text-white text-xs font-medium hover:bg-[var(--color-accent)]/90 transition-all cursor-pointer"
            >
              <span>Open {slide.cta}</span>
              <span aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              onClick={onConnect}
              disabled={loadingConnect}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-canvas)] border border-[var(--color-line)] text-xs font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-strong)] transition-colors cursor-pointer disabled:opacity-50"
            >
              {connected ? "Switch org" : "Connect to Salesforce"}
            </button>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Hero slides">
              <button
                type="button"
                onClick={() => setIdx((idx + HERO_SLIDES.length - 1) % HERO_SLIDES.length)}
                aria-label="Previous slide"
                className="rounded p-1 text-ivory-500 hover:text-ivory-950 transition-colors cursor-pointer"
              >
                ‹
              </button>
              {HERO_SLIDES.map((s, i) => (
                <button
                  key={s.cta}
                  type="button"
                  role="tab"
                  aria-selected={i === idx}
                  aria-label={`Slide ${i + 1}: ${s.cta}`}
                  onClick={() => setIdx(i)}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                    i === idx ? "w-6 bg-bronze-600" : "w-1.5 bg-ivory-400 hover:bg-ivory-600"
                  }`}
                />
              ))}
              <button
                type="button"
                onClick={() => setIdx((idx + 1) % HERO_SLIDES.length)}
                aria-label="Next slide"
                className="rounded p-1 text-ivory-500 hover:text-ivory-950 transition-colors cursor-pointer"
              >
                ›
              </button>
            </div>
            <button
              type="button"
              onClick={onHowItWorks}
              className="text-xs text-ivory-600 hover:text-ivory-950 underline underline-offset-2 cursor-pointer"
            >
              How it works
            </button>
          </div>
          {connectError && (
            <div className="mt-4 max-w-xl rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {connectError}{" "}
              <button type="button" onClick={onConnect} className="underline font-medium cursor-pointer">
                Try again
              </button>
            </div>
          )}
        </div>
        <div className="relative mx-auto w-full flex flex-col justify-center">
          <div className="rounded-2xl bg-[#0c0d14] p-2 shadow-[0_32px_80px_-32px_rgba(12,13,20,0.7)] w-full">
            <div className="relative min-h-[420px] lg:min-h-[480px] overflow-hidden rounded-xl bg-[#0c0d14]">
              {HERO_IMAGES.map((img, i) => (
                <div
                  key={img.src}
                  className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${
                    i === heroImgIdx ? "opacity-100 z-10" : "opacity-0 z-0 pointer-events-none"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.src}
                    alt={img.alt}
                    className="h-full w-full object-contain object-center"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
                </div>
              ))}
              <div
                className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 p-1 rounded-full bg-black/40 backdrop-blur-sm border border-white/10"
                role="tablist"
                aria-label="Hero image slides"
              >
                {HERO_IMAGES.map((img, i) => (
                  <button
                    key={img.src}
                    type="button"
                    role="tab"
                    aria-selected={i === heroImgIdx}
                    aria-label={`Image ${i + 1}: ${img.alt}`}
                    onClick={() => setIdx(i)}
                    className={`h-2 rounded-full transition-all duration-300 cursor-pointer ${
                      i === heroImgIdx ? "w-6 bg-[var(--color-accent)]" : "w-2 bg-white/40 hover:bg-white/70"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const router = useRouter();
  const [state, setState] = useState<AppState>(initialState);
  const [loading, setLoading] = useState<LoadingState>({
    connect: false,
    objects: false,
    describe: false,
  });
  const [errors, setErrors] = useState<ErrorState>({
    connect: null,
    objects: null,
    describe: null,
  });

  // Architect-shell UI state
  const [showWelcome, setShowWelcome] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showCollection, setShowCollection] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collection, setCollection] = useState<CollectionItem[]>([]);
  const [pickerItem, setPickerItem] = useState<NewCollectionItem | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [queryLang, setQueryLang] = useState<"soql" | "sosl">("soql");
  const [builderLeftOpen, setBuilderLeftOpen] = useState(true);
  const [builderRightOpen, setBuilderRightOpen] = useState(true);
  const [builderPayloadOpen, setBuilderPayloadOpen] = useState(true);
  const [builderTestOpen, setBuilderTestOpen] = useState(true);
  // Org key for workspace autosave: resolved from the live session after
  // login (org id, host fallback). Never derived from - or containing - tokens.
  const [orgKey, setOrgKey] = useState<string | null>(null);
  const [builderTabs, setBuilderTabs] = useState<BuilderTab[]>(() => [
    { tabId: newItemId(), name: null, draft: freshBuilderDraft() },
  ]);
  const [activeBuilderTabId, setActiveBuilderTabId] = useState<string>("");
  const [renamingBuilderTabId, setRenamingBuilderTabId] = useState<string | null>(null);
  // Schema canvas tabs: full parallel SchemaPanel instances. Mounted once,
  // kept alive across switches - each owns its memory + autosave slices.
  const [schemaTabs, setSchemaTabs] = useState<SchemaTab[]>(() => [
    { tabId: newItemId(), name: "Canvas 1" },
  ]);
  const [activeSchemaTabId, setActiveSchemaTabId] = useState<string>("");
  /** Cross-tab schema navigation: one panel's inbox asks to land on another tab. */
  const [schemaNav, setSchemaNav] = useState<SchemaNavRequest | null>(null);

  const handleRequestTab = useCallback(
    (targetTabId: string, nav: Omit<SchemaNavRequest, "tabId">, fromTabId: string) => {
      const live = schemaTabs.some((t) => t.tabId === targetTabId);
      const tabId = live ? targetTabId : fromTabId;
      if (live) setActiveSchemaTabId(targetTabId);
      setSchemaNav({ ...nav, tabId });
    },
    [schemaTabs]
  );

  /** Console deep link (?canvas=tabId): land on schema with the right canvas. */
  const deepCanvas = useDeepParam("canvas");
  const deepCanvasDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepCanvas || schemaTabs.length === 0 || deepCanvasDoneRef.current === deepCanvas) return;
    const target = schemaTabs.find((t) => t.tabId === deepCanvas);
    if (!target) return;
    deepCanvasDoneRef.current = deepCanvas;
    setActiveSchemaTabId(target.tabId);
    goMode("schema");
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("canvas");
      url.searchParams.delete("mode");
      const rest = url.searchParams.toString();
      window.history.replaceState(null, "", url.pathname + (rest ? `?${rest}` : "") + url.hash);
    } catch {
      /* non-browser - ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepCanvas, schemaTabs]);
  const [renamingSchemaTabId, setRenamingSchemaTabId] = useState<string | null>(null);
  // Resolve active tab (defaults to first). updateDraft below writes through
  // the ref so async describe resolutions land in the tab that started them.
  const activeBuilderTabRef = useRef<string>("");
  const activeBuilderTab = builderTabs.find((t) => t.tabId === activeBuilderTabId) ?? builderTabs[0];
  activeBuilderTabRef.current = activeBuilderTab.tabId;
  const draft = activeBuilderTab.draft;
  const updateDraft = useCallback((updater: (d: BuilderDraft) => BuilderDraft) => {
    const id = activeBuilderTabRef.current;
    setBuilderTabs((prev) => prev.map((t) => (t.tabId === id ? { ...t, draft: updater(t.draft) } : t)));
  }, []);

  const handleSessionExpired = useCallback(() => {
    clearCachedConnection();
    markSessionExpired();
    setSessionExpired(true);
  }, []);

  // Graceful boot: cover connect + initial object load so the UI never
  // pops in half-built. Fades out once the object list lands (or fails).
  const bootActive =
    loading.connect || (state.connected && loading.objects && state.objects.length === 0);
  const [bootShown, setBootShown] = useState(false);
  const [bootFade, setBootFade] = useState(false);
  useEffect(() => {
    let t: number | undefined;
    if (bootActive) {
      setBootShown(true);
      setBootFade(false);
    } else if (bootShown) {
      setBootFade(true);
      t = window.setTimeout(() => setBootShown(false), 300);
    }
    return () => window.clearTimeout(t);
  }, [bootActive, bootShown]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [savedCreds, setSavedCreds] = useState(readSavedCreds);

  // Token stored in ref - never in rendered state or localStorage
  const tokenRef = useRef<string>("");

  // Jump-link intent from the hero carousel when offline: connect first, land after.
  const pendingModeRef = useRef<Exclude<BuilderMode, "home"> | null>(null);

  const openConnect = useCallback(() => {
    setSavedCreds(readSavedCreds());
    setShowWelcome(false);
    setShowConnect(true);
  }, []);

  // Header nav: offline → prompt connect; online → switch mode + scroll to section
  const goMode = useCallback((mode: BuilderMode) => {
    setState((p) => ({ ...p, mode }));
    if (mode === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.setTimeout(() => {
      const id =
        mode === "composite" ? "composite"
        : mode === "soql" ? "soql"
        : mode === "graphql" ? "graphql"
        : mode === "schema" ? "schema"
        : mode === "rest" ? "rest"
        : mode === "apex" ? "apex"
        : mode === "events" ? "events"
        : mode === "webhooks" ? "webhooks"
        : mode === "explore" ? "explore"
        : "builder";
      scrollToSection(id, false);
    }, 80);
  }, []);

  const handleNavigate = useCallback(
    (mode: "home" | "builder" | "composite" | "soql" | "graphql" | "schema" | "rest" | "apex" | "events" | "webhooks" | "explore") => {
      // Home is always available - it just shows the start screen.
      if (mode === "home") {
        goMode("home");
        return;
      }
      if (!state.connected) {
        openConnect();
        return;
      }
      goMode(mode === "builder" ? "single" : mode);
    },
    [state.connected, openConnect, goMode]
  );

  // Hero carousel jump links: offline visitors connect first, then land
  // on the chosen builder automatically. Standalone routes push directly -
  // each owns its own disconnected gate.
  const jumpToMode = useCallback(
    (mode: HeroMode) => {
      if (mode === "json") {
        router.push("/json");
        return;
      }
      if (mode === "contracts") {
        router.push("/contracts");
        return;
      }
      if (isHeroRoute(mode)) {
        router.push(`/${mode}`);
        return;
      }
      if (!state.connected) {
        pendingModeRef.current = mode;
        openConnect();
        return;
      }
      goMode(mode);
    },
    [state.connected, openConnect, goMode, router]
  );

  // Deep link: ?tab= lands on the exact home mode (schema links use it), or
  // on a standalone route tab (system, sequence, wireframe, console, draw,
  // json, contracts, architect, decisions, notes, requirements, knowledge).
  // Runs once - offline visitors connect first, then land automatically.
  const deepTabDone = useRef(false);
  useEffect(() => {
    if (deepTabDone.current) return;
    let tab: string | null = null;
    try {
      const q = new URLSearchParams(window.location.search);
      tab = q.get("tab")?.trim() || q.get("mode")?.trim() || null;
    } catch {
      tab = null;
    }
    if (!tab) return;
    const routes = [
      "system", "sequence", "wireframe", "console", "draw", "json", "contracts",
      "architect", "decisions", "notes", "requirements", "knowledge", "setup", "docs",
    ];
    if (routes.includes(tab)) {
      deepTabDone.current = true;
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("tab");
        url.searchParams.delete("mode");
        window.history.replaceState(null, "", `/${tab}${url.search}${url.hash}`);
      } catch {
        /* fall through to plain navigation */
      }
      router.push(`/${tab}`);
      return;
    }
    const mode = tab === "builder" ? "single" : tab;
    if (mode !== "single" && mode !== "composite" && mode !== "soql" && mode !== "graphql" && mode !== "schema" && mode !== "rest" && mode !== "apex" && mode !== "events") return;
    deepTabDone.current = true;
    jumpToMode(mode as Exclude<BuilderMode, "home">);
  }, [jumpToMode, router]);

  // Zig-zag capability opener: modes via jump flow, routes direct.
  const openZigZag = useCallback(
    (t: ZigZagTarget) => {
      if (t.kind === "route") {
        router.push(t.href);
        return;
      }
      jumpToMode(t.mode);
    },
    [router, jumpToMode]
  );

  // On mount: restore session, seed modal prefill, decide on welcome,
  // and reload the persisted request collection (IndexedDB).
  // Fast path first: the module connection cache survives client-side route
  // trips (JSON / Contracts / Architect unmount this page) - hydrate
  // instantly with zero network and zero boot modal. A dead restored session
  // pops the Connect dialog instead of failing silently.
  useEffect(() => {
    setSavedCreds(readSavedCreds());
    const conn = getCachedConnection();
    if (conn) {
      tokenRef.current = conn.token;
      sessionStorage.setItem("sf_welcomed", "1");
      setOrgKey(conn.orgKey);
      setState((prev) => ({
        ...prev,
        connected: true,
        instanceUrl: conn.instanceUrl,
        token: "",
        apiVersion: conn.apiVersion,
        objects: conn.objects,
        objectCount: conn.objectCount,
      }));
      return;
    }
    const saved = sessionStorage.getItem("gravenx_session");
    if (!saved) {
      if (!sessionStorage.getItem("sf_welcomed")) setShowWelcome(true);
      return;
    }
    try {
      const { instanceUrl, token, apiVersion } = JSON.parse(saved) as {
        instanceUrl: string;
        token: string;
        apiVersion: string;
      };
      if (instanceUrl && token && apiVersion) {
        sessionStorage.setItem("sf_welcomed", "1");
        void handleConnect(instanceUrl, token, apiVersion).then((ok) => {
          if (!ok) {
            setSavedCreds(readSavedCreds());
            setShowConnect(true);
          }
        });
      } else if (!sessionStorage.getItem("sf_welcomed")) {
        setShowWelcome(true);
      }
    } catch {
      sessionStorage.removeItem("gravenx_session");
      if (!sessionStorage.getItem("sf_welcomed")) setShowWelcome(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep route entry: /?mode=composite (from route headers) lands on that
  // builder - connect first when offline, via the pending-mode flow.
  // Collaboration entry: /?share=<id> parks the id until connected, then the
  // active schema tab imports it (structure in, metadata resolved locally).
  const [shareId, setShareId] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const m = params.get("mode");
    const share = params.get("share");
    const valid = ["single", "composite", "soql", "graphql", "schema", "rest", "apex", "events", "home", "json", "contracts"];
    if (share && /^[a-z0-9]{16,64}$/i.test(share)) {
      setShareId(share);
      history.replaceState(null, "", window.location.pathname);
      jumpToMode("schema");
      return;
    }
    if (m && valid.includes(m)) {
      history.replaceState(null, "", window.location.pathname);
      if (m !== "home") jumpToMode(m as Exclude<BuilderMode, "home"> | "json" | "contracts");
      else goMode("home");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persisted collections + staged items live in IndexedDB - reload them
  // (fail-soft to memory). Legacy items without a collectionId are backfilled
  // into the default collection.
  useEffect(() => {
    (async () => {
      try {
        let cols = await listCollections();
        if (cols.length === 0) {
          const now = Date.now();
          const def: Collection = {
            id: newItemId(),
            name: "My Collection",
            createdAt: now,
            updatedAt: now,
          };
          await saveCollection(def);
          cols = [def];
        }
        const items = await listCollectionItems();
        const orphans = items.filter((i) => !i.collectionId);
        if (orphans.length > 0) {
          await Promise.all(
            orphans.map((o) => saveCollectionItem({ ...o, collectionId: cols[0].id }))
          );
          items.forEach((i) => {
            if (!i.collectionId) i.collectionId = cols[0].id;
          });
        }
        setCollections(cols);
        setActiveCollectionId(cols[0].id);
        setCollection(items);
      } catch {
        setCollections([]);
        setCollection([]);
      }
    })();
  }, []);

  // Unmount cleanup for the toast timer
  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  // Deep links: #how-it-works opens the walkthrough modal, anything else scrolls after paint
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    setShowWelcome(false);
    sessionStorage.setItem("sf_welcomed", "1");
    if (hash === "how-it-works") {
      setShowHowItWorks(true);
      return;
    }
    const t = window.setTimeout(() => {
      scrollToSection(hash, false);
    }, 150);
    return () => window.clearTimeout(t);
  }, []);

  // Connection success → dismiss welcome + connect + expired modals,
  // then honor any pending hero jump-link
  useEffect(() => {
    if (state.connected) {
      setShowConnect(false);
      setShowWelcome(false);
      setSessionExpired(false);
      clearSessionExpired();
      sessionStorage.setItem("sf_welcomed", "1");
      if (pendingModeRef.current) {
        const m = pendingModeRef.current;
        pendingModeRef.current = null;
        goMode(m);
      }
    }
  }, [state.connected, goMode]);

  // Global ⌘K / Ctrl+K → object quick-find when connected
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (state.connected && state.objects.length > 0) {
          e.preventDefault();
          setShowSearch(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.connected, state.objects.length]);

  const setLoadingKey = (key: keyof LoadingState, value: boolean) =>
    setLoading((prev) => ({ ...prev, [key]: value }));
  const setErrorKey = (key: keyof ErrorState, value: string | null) =>
    setErrors((prev) => ({ ...prev, [key]: value }));

  /** Resolve the autosave org key from the live session (one cheap query). */
  const resolveOrgKey = useCallback(
    async (instanceUrl: string, token: string, apiVersion: string): Promise<string> => {
      try {
        const r = await apiFetch(
          "/api/salesforce/soql",
          { instanceUrl, token, apiVersion, soql: "SELECT Id FROM Organization LIMIT 1" },
          15000
        );
        const d = (await r.json()) as { records?: { Id?: string }[] };
        const id = d?.records?.[0]?.Id;
        if (r.ok && typeof id === "string" && id.length >= 15) return `org:${id.slice(0, 15)}`;
      } catch {
        /* fall through to host key */
      }
      try {
        return `host:${new URL(instanceUrl).host.toLowerCase()}`;
      } catch {
        return `host:${instanceUrl}`;
      }
    },
    []
  );

  const handleConnect = useCallback(
    async (instanceUrl: string, token: string, apiVersion: string): Promise<boolean> => {
      setLoadingKey("connect", true);
      setErrorKey("connect", null);

      try {
        const response = await apiFetch("/api/salesforce/connect", { instanceUrl, token, apiVersion });

        const data = (await response.json()) as { success?: boolean; objectCount?: number; error?: string };

        if (!response.ok || !data.success) {
          setErrorKey("connect", data.error ?? "Connection failed");
          return false;
        }

        // Store token in ref, NOT in rendered state
        tokenRef.current = token;

        // Persist session for refresh survival (sessionStorage: tab-scoped, clears on tab close)
        sessionStorage.setItem("gravenx_session", JSON.stringify({ instanceUrl, token, apiVersion }));
        setSavedCreds({ instanceUrl, token, apiVersion });

        setState((prev) => ({
          ...prev,
          connected: true,
          instanceUrl,
          apiVersion,
          objectCount: data.objectCount ?? 0,
          token: "", // never put token in state
        }));

        // Re-auth while connected leaves connected true, so the dismiss
        // effect never refires - close the connect + expired modals here on
        // every success (harmless on boot/fresh connect, which also close).
        setShowConnect(false);
        setSessionExpired(false);
        clearSessionExpired();

        // Load objects immediately (returns them so the caller can cache the connection)
        const objs = await loadObjects(instanceUrl, token, apiVersion);
        const key = await resolveOrgKey(instanceUrl, token, apiVersion);
        setOrgKey(key);
        setCachedConnection({ instanceUrl, token, apiVersion, objects: objs, objectCount: data.objectCount ?? 0, orgKey: key });
        return true;
      } catch (err) {
        setErrorKey("connect", err instanceof Error ? err.message : "Connection failed");
        return false;
      } finally {
        setLoadingKey("connect", false);
      }
    },
    [resolveOrgKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const loadObjects = async (instanceUrl: string, token: string, apiVersion: string): Promise<SalesforceObject[]> => {
    setLoadingKey("objects", true);
    setErrorKey("objects", null);

    try {
      const response = await apiFetch("/api/salesforce/objects", { instanceUrl, token, apiVersion });

      const data = (await response.json()) as { objects?: SalesforceObject[]; error?: string };

      if (!response.ok) {
        const message = data.error ?? "Failed to load objects";
        setErrorKey("objects", message);
        if (isSessionExpiredMessage(message)) handleSessionExpired();
        return [];
      }

      setState((prev) => ({ ...prev, objects: data.objects ?? [] }));
      return data.objects ?? [];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load objects";
      setErrorKey("objects", message);
      if (isSessionExpiredMessage(message)) handleSessionExpired();
      return [];
    } finally {
      setLoadingKey("objects", false);
    }
  };

  const handleObjectSelect = useCallback(
    async (obj: SalesforceObject) => {
      const tabId = activeBuilderTabRef.current;
      setBuilderTabs((prev) =>
        prev.map((t) =>
          t.tabId === tabId
            ? {
                ...t,
                draft: {
                  ...t.draft,
                  selectedObject: obj,
                  describe: null,
                  selectedFieldNames: new Set(),
                  fieldValues: {},
                  generatedPayload: null,
                },
              }
            : t
        )
      );
      setErrorKey("describe", null);
      setLoadingKey("describe", true);

      try {
        const response = await apiFetch("/api/salesforce/describe", {
          instanceUrl: state.instanceUrl,
          token: tokenRef.current,
          apiVersion: state.apiVersion,
          objectName: obj.name,
        });

        const data = (await response.json()) as SalesforceDescribeResult & { error?: string };

        if (!response.ok) {
          const message = (data as unknown as { error: string }).error ?? "Failed to load fields";
          setErrorKey("describe", message);
          if (isSessionExpiredMessage(message)) handleSessionExpired();
          return;
        }

        setBuilderTabs((prev) =>
          prev.map((t) => {
            if (t.tabId !== tabId) return t;
            // Auto-select required fields for the current operation (POST) with
            // sample values, so a built request starts valid. User can uncheck.
            const required = getWritableFields(data.fields, t.draft.operation).filter((f) =>
              isRequiredField(f, t.draft.operation)
            );
            const selectedFieldNames = new Set(required.map((f) => f.name));
            const fieldValues: Record<string, unknown> = {};
            for (const f of required) {
              fieldValues[f.name] = getSampleValueForField(f);
            }
            return { ...t, draft: { ...t.draft, describe: data, selectedFieldNames, fieldValues, generatedPayload: null } };
          })
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load fields";
        setErrorKey("describe", message);
        if (isSessionExpiredMessage(message)) handleSessionExpired();
      } finally {
        setLoadingKey("describe", false);
      }
    },
    [state.instanceUrl, state.apiVersion, handleSessionExpired]
  );

  const handleToggleField = useCallback((fieldName: string) => {
    updateDraft((prev) => {
      const next = new Set(prev.selectedFieldNames);
      const isAdding = !next.has(fieldName);
      if (isAdding) {
        next.add(fieldName);
      } else {
        next.delete(fieldName);
      }
      // Auto-seed a sample value when field is first selected (only if no value already set)
      let fieldValues = prev.fieldValues;
      if (isAdding && prev.describe) {
        const field = prev.describe.fields.find((f) => f.name === fieldName);
        if (field && (fieldValues[fieldName] === undefined || fieldValues[fieldName] === "")) {
          fieldValues = { ...fieldValues, [fieldName]: getSampleValueForField(field) };
        }
      }
      return { ...prev, selectedFieldNames: next, fieldValues, generatedPayload: null };
    });
  }, [updateDraft]);

  const handleSelectAll = useCallback((fields: SalesforceField[]) => {
    updateDraft((prev) => {
      const next = new Set(prev.selectedFieldNames);
      const newValues = { ...prev.fieldValues };
      fields.forEach((f) => {
        next.add(f.name);
        if (newValues[f.name] === undefined || newValues[f.name] === "") {
          newValues[f.name] = getSampleValueForField(f);
        }
      });
      return { ...prev, selectedFieldNames: next, fieldValues: newValues, generatedPayload: null };
    });
  }, [updateDraft]);

  const handleClearAll = useCallback(() => {
    updateDraft((prev) => ({
      ...prev,
      selectedFieldNames: new Set(),
      fieldValues: {},
      generatedPayload: null,
    }));
  }, [updateDraft]);

  const handleFieldValueChange = useCallback((fieldName: string, value: unknown) => {
    updateDraft((prev) => ({
      ...prev,
      fieldValues: { ...prev.fieldValues, [fieldName]: value },
      generatedPayload: null,
    }));
  }, [updateDraft]);

  const handleOperationChange = useCallback((op: OperationType) => {
    updateDraft((prev) => ({ ...prev, operation: op, generatedPayload: null }));
  }, [updateDraft]);

  const handleRecordIdChange = useCallback((id: string) => {
    updateDraft((prev) => ({ ...prev, recordId: id }));
  }, [updateDraft]);

  const handleGenerateSamples = useCallback(() => {
    updateDraft((prev) => {
      if (!prev.describe) return prev;
      const writableFields = getWritableFields(
        prev.describe.fields.filter((f) => prev.selectedFieldNames.has(f.name)),
        prev.operation
      );
      const samples = generateSampleValues(writableFields);
      return {
        ...prev,
        fieldValues: { ...prev.fieldValues, ...samples },
        generatedPayload: null,
      };
    });
  }, [updateDraft]);

  const handleGeneratePayload = useCallback(() => {
    const id = activeBuilderTabRef.current;
    setBuilderTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.tabId !== id) return t;
        const d = t.draft;
        if (!d.describe || !d.selectedObject) return t;
        const selectedFields = d.describe.fields.filter((f) =>
          d.selectedFieldNames.has(f.name)
        );
        const payload = generatePayload(selectedFields, d.fieldValues, d.operation);
        const endpoint = generateEndpoint(
          state.instanceUrl,
          state.apiVersion,
          d.selectedObject.name,
          d.operation,
          d.recordId || undefined
        );
        return {
          ...t,
          draft: {
            ...d,
            generatedPayload: {
              operation: d.operation,
              objectName: d.selectedObject.name,
              endpoint,
              payload,
              recordId: d.recordId || undefined,
            },
          },
        };
      })
    );
  }, [state.instanceUrl, state.apiVersion]);

  // ── Builder request tabs ──
  const switchBuilderTab = useCallback((tabId: string) => {
    setActiveBuilderTabId(tabId);
    activeBuilderTabRef.current = tabId;
    setErrorKey("describe", null);
  }, []);

  const addBuilderTab = useCallback(() => {
    setBuilderTabs((prev) => {
      if (prev.length >= MAX_BUILDER_TABS) return prev;
      const tabId = newItemId();
      const next = [...prev, { tabId, name: null, draft: freshBuilderDraft() }];
      setActiveBuilderTabId(tabId);
      activeBuilderTabRef.current = tabId;
      setErrorKey("describe", null);
      return next;
    });
  }, []);

  const [pendingCloseBuilder, setPendingCloseBuilder] = useState<string | null>(null);

  const doCloseBuilderTab = useCallback((tabId: string) => {
    setPendingCloseBuilder(null);
    setBuilderTabs((prev) => {
      if (!prev.some((t) => t.tabId === tabId)) return prev;
      if (prev.length <= 1) return [{ tabId, name: null, draft: freshBuilderDraft() }];
      const remaining = prev.filter((t) => t.tabId !== tabId);
      if (activeBuilderTabRef.current === tabId) {
        const next = remaining[remaining.length - 1].tabId;
        setActiveBuilderTabId(next);
        activeBuilderTabRef.current = next;
        setErrorKey("describe", null);
      }
      return remaining;
    });
  }, []);

  const closeBuilderTab = useCallback((tabId: string) => {
    const tab = builderTabs.find((t) => t.tabId === tabId);
    if (!tab) return;
    const dirty =
      tab.draft.selectedObject !== null ||
      tab.draft.selectedFieldNames.size > 0 ||
      tab.draft.generatedPayload !== null;
    if (dirty) setPendingCloseBuilder(tabId);
    else doCloseBuilderTab(tabId);
  }, [builderTabs, doCloseBuilderTab]);

  const renameBuilderTab = useCallback((tabId: string, name: string) => {
    setBuilderTabs((prev) =>
      prev.map((t) => (t.tabId === tabId ? { ...t, name: name.trim() || null } : t))
    );
    setRenamingBuilderTabId(null);
  }, []);

  // ── Builder workspace autosave (per org): full drafts incl. describes,
  // restored as-is - zero API calls. Saves queue on change; restore runs once
  // per org into a pristine workspace and never clobbers fresh user work.
  interface BuilderTabAutosave {
    name: string | null;
    objectName: string | null;
    fieldNames: string[];
    fieldValues: Record<string, unknown>;
    operation: OperationType;
    recordId: string;
    payload: GeneratedPayload | null;
    describe: SalesforceDescribeResult | null;
  }
  interface BuilderAutosaveData {
    tabs: BuilderTabAutosave[];
    activeIndex: number;
  }
  const builderRestoredRef = useRef<string | null>(null);
  const isPristineTabs = (tabs: BuilderTab[]) =>
    tabs.length === 1 &&
    tabs[0].draft.selectedObject === null &&
    tabs[0].draft.selectedFieldNames.size === 0 &&
    tabs[0].draft.generatedPayload === null;

  useEffect(() => {
    if (!state.connected || !orgKey) return;
    if (builderRestoredRef.current !== orgKey) return;
    queueAutosave(orgKey, "builder", {
      tabs: builderTabs.map((t): BuilderTabAutosave => ({
        name: t.name,
        objectName: t.draft.selectedObject?.name ?? null,
        fieldNames: [...t.draft.selectedFieldNames],
        fieldValues: t.draft.fieldValues,
        operation: t.draft.operation,
        recordId: t.draft.recordId,
        payload: t.draft.generatedPayload,
        describe: t.draft.describe,
      })),
      activeIndex: Math.max(
        0,
        builderTabs.findIndex((t) => t.tabId === activeBuilderTabRef.current)
      ),
    } satisfies BuilderAutosaveData);
  }, [builderTabs, state.connected, orgKey]);

  useEffect(() => {
    if (!state.connected || !orgKey || state.objects.length === 0) return;
    if (builderRestoredRef.current === orgKey) return;
    builderRestoredRef.current = orgKey;
    void (async () => {
      const snap = await loadAutosave<BuilderAutosaveData>(orgKey, "builder");
      if (!snap || snap.data.tabs.length === 0) return;
      if (!isPristineTabs(builderTabs)) return;
      const tabs: BuilderTab[] = snap.data.tabs.slice(0, MAX_BUILDER_TABS).map((s) => {
        const obj = s.objectName ? (state.objects.find((o) => o.name === s.objectName) ?? null) : null;
        return {
          tabId: newItemId(),
          name: s.name,
          draft: {
            selectedObject: obj,
            describe: obj ? s.describe : null,
            selectedFieldNames: obj ? new Set(s.fieldNames ?? []) : new Set(),
            fieldValues: obj ? (s.fieldValues ?? {}) : {},
            operation: s.operation ?? "POST",
            recordId: s.recordId ?? "",
            generatedPayload: obj ? s.payload : null,
          },
        };
      });
      if (tabs.length === 0) return;
      setBuilderTabs((prev) => (isPristineTabs(prev) ? tabs : prev));
      const idx = Math.min(snap.data.activeIndex ?? 0, tabs.length - 1);
      setActiveBuilderTabId((prevActive) => {
        if (prevActive) return prevActive;
        activeBuilderTabRef.current = tabs[idx].tabId;
        return tabs[idx].tabId;
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connected, orgKey, state.objects]);

  // ── Last-mode + schema-tab autosave: returning from JSON / Contracts /
  // Architect lands back where work was happening instead of the home hero,
  // with every canvas tab tracked and restorable.
  interface MetaAutosaveData {
    mode: string;
    schemaTabs?: { tabId: string; name: string }[];
    activeSchemaTab?: string;
  }
  const modeRestoredRef = useRef(false);
  useEffect(() => {
    if (!state.connected || !orgKey || modeRestoredRef.current) return;
    modeRestoredRef.current = true;
    const deepLink = new URLSearchParams(window.location.search).get("mode");
    void (async () => {
      const snap = await loadAutosave<MetaAutosaveData>(orgKey, "meta");
      const tabs = snap?.data.schemaTabs?.filter((t) => t.tabId && t.name).slice(0, MAX_SCHEMA_TABS);
      if (tabs && tabs.length > 0) {
        setSchemaTabs(tabs);
        const active = snap?.data.activeSchemaTab;
        setActiveSchemaTabId(active && tabs.some((t) => t.tabId === active) ? active : tabs[0].tabId);
      } else {
        // First run on this org: Tab 1 inherits the legacy unscoped canvas.
        const id = newItemId();
        setSchemaTabs([{ tabId: id, name: "Canvas 1" }]);
        setActiveSchemaTabId(id);
        void migrateLegacyWorkspace(orgKey, id);
      }
      if (deepLink) return; // deep link wins for mode
      // Home means home: the saved mode restores only on a real browser
      // reload. Header/brand Home clicks (client-side nav to "/") must land
      // on the hero, never yank back into the last build tab.
      const navEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (navEntry && navEntry.type !== "reload") return;
      const m = snap?.data.mode;
      if (m && m !== "home" && (m as BuilderMode) !== state.mode) goMode(m as BuilderMode);
    })();
  }, [state.connected, orgKey, state.mode, goMode]);
  useEffect(() => {
    if (!state.connected || !orgKey) return;
    if (!modeRestoredRef.current) return;
    queueAutosave(orgKey, "meta", {
      mode: state.mode,
      schemaTabs: schemaTabs.map((t) => ({ tabId: t.tabId, name: t.name })),
      activeSchemaTab: activeSchemaTabId || schemaTabs[0]?.tabId,
    } satisfies MetaAutosaveData);
  }, [state.mode, state.connected, orgKey, schemaTabs, activeSchemaTabId]);

  // ── Schema canvas tabs ──
  const addSchemaTab = useCallback(() => {
    setSchemaTabs((prev) => {
      if (prev.length >= MAX_SCHEMA_TABS) return prev;
      const tabId = newItemId();
      const next = [...prev, { tabId, name: `Canvas ${prev.length + 1}` }];
      setActiveSchemaTabId(tabId);
      return next;
    });
  }, []);

  const [pendingCloseSchema, setPendingCloseSchema] = useState<string | null>(null);

  const doCloseSchemaTab = useCallback((tabId: string) => {
    setPendingCloseSchema(null);
    if (orgKey) {
      void clearAutosave(orgKey, "schema", tabId);
      void clearAutosave(orgKey, "notes", tabId);
    }
    setSchemaTabs((prev) => {
      if (!prev.some((t) => t.tabId === tabId)) return prev;
      if (prev.length <= 1) return [{ tabId, name: "Canvas 1" }];
      const remaining = prev.filter((t) => t.tabId !== tabId);
      setActiveSchemaTabId((cur) => (cur === tabId || !cur ? remaining[remaining.length - 1].tabId : cur));
      return remaining;
    });
  }, [orgKey]);

  const closeSchemaTab = useCallback((tabId: string) => {
    if (!schemaTabs.some((t) => t.tabId === tabId)) return;
    setPendingCloseSchema(tabId);
  }, [schemaTabs]);

  const renameSchemaTab = useCallback((tabId: string, name: string) => {
    setSchemaTabs((prev) =>
      prev.map((t) => (t.tabId === tabId ? { ...t, name: name.trim() || t.name } : t))
    );
    setRenamingSchemaTabId(null);
  }, []);

  const handleDisconnect = useCallback(() => {
    tokenRef.current = "";
    clearCachedConnection();
    flushAutosaves();
    builderRestoredRef.current = null;
    modeRestoredRef.current = false;
    setOrgKey(null);
    sessionStorage.removeItem("gravenx_session");
    setShowSearch(false);
    setShowConnect(false);
    setSessionExpired(false);
    setState(initialState);
    setBuilderTabs([{ tabId: newItemId(), name: null, draft: freshBuilderDraft() }]);
    setActiveBuilderTabId("");
    setRenamingBuilderTabId(null);
    setSchemaTabs([{ tabId: newItemId(), name: "Canvas 1" }]);
    setActiveSchemaTabId("");
    setRenamingSchemaTabId(null);
    setErrors({ connect: null, objects: null, describe: null });
  }, []);

  const flashToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  const addToCollection = useCallback(
    async (collectionId: string, item: NewCollectionItem) => {
      const target = collections.find((c) => c.id === collectionId) ?? collections[0];
      if (!target) return;
      const full: CollectionItem = {
        ...item,
        id: newItemId(),
        collectionId: target.id,
        createdAt: Date.now(),
      };
      setCollection((prev) => [full, ...prev]);
      setCollections((prev) =>
        prev.map((c) => (c.id === target.id ? { ...c, updatedAt: Date.now() } : c))
      );
      saveCollectionItem(full).catch(() => {
        /* IndexedDB unavailable - item still staged in memory */
      });
      saveCollection({ ...target, updatedAt: Date.now() }).catch(() => {});
      const count = collection.filter((i) => i.collectionId === target.id).length + 1;
      flashToast(`Added to “${target.name}” (${count} staged)`);
    },
    [collections, collection, flashToast]
  );

  // "+ Collection" in any builder → ask which collection it goes to
  const requestAddToCollection = useCallback((item: NewCollectionItem) => {
    setPickerItem(item);
  }, []);

  const createCollectionAndAdd = useCallback(
    async (name: string) => {
      if (!pickerItem) return;
      const now = Date.now();
      const col: Collection = { id: newItemId(), name, createdAt: now, updatedAt: now };
      setCollections((prev) => [...prev, col]);
      setActiveCollectionId(col.id);
      saveCollection(col).catch(() => {});
      setPickerItem(null);
      await addToCollection(col.id, pickerItem);
    },
    [pickerItem, addToCollection]
  );

  const confirmAddToCollection = useCallback(
    async (collectionId: string) => {
      if (!pickerItem) return;
      setPickerItem(null);
      await addToCollection(collectionId, pickerItem);
    },
    [pickerItem, addToCollection]
  );

  const createCollection = useCallback(
    async (name: string) => {
      const now = Date.now();
      const col: Collection = { id: newItemId(), name, createdAt: now, updatedAt: now };
      setCollections((prev) => [...prev, col]);
      setActiveCollectionId(col.id);
      saveCollection(col).catch(() => {});
      flashToast(`Collection “${name}” created`);
    },
    [flashToast]
  );

  const renameCollection = useCallback((id: string, name: string) => {
    setCollections((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name, updatedAt: Date.now() } : c))
    );
    saveCollection({
      ...(collections.find((c) => c.id === id) as Collection),
      name,
      updatedAt: Date.now(),
    }).catch(() => {});
  }, [collections]);

  const deleteCollectionHandler = useCallback(
    (id: string) => {
      const remaining = collections.filter((c) => c.id !== id);
      const doomed = collection.filter((i) => i.collectionId === id);
      setCollections(remaining.length > 0 ? remaining : []);
      setCollection((prev) => prev.filter((i) => i.collectionId !== id));
      if (activeCollectionId === id) {
        setActiveCollectionId(remaining[0]?.id ?? null);
      }
      deleteCollectionFromDb(id).catch(() => {});
      Promise.all(doomed.map((i) => deleteCollectionItem(i.id))).catch(() => {});
      // Never leave zero collections - recreate the default
      if (remaining.length === 0) {
        const now = Date.now();
        const def: Collection = { id: newItemId(), name: "My Collection", createdAt: now, updatedAt: now };
        setCollections([def]);
        setActiveCollectionId(def.id);
        saveCollection(def).catch(() => {});
      }
    },
    [collections, collection, activeCollectionId]
  );

  const removeFromCollection = useCallback((id: string) => {
    setCollection((prev) => prev.filter((i) => i.id !== id));
    deleteCollectionItem(id).catch(() => {});
  }, []);

  const renameCollectionItem = useCallback((id: string, name: string) => {
    setCollection((prev) => {
      const next = prev.map((i) => (i.id === id ? { ...i, name } : i));
      const updated = next.find((i) => i.id === id);
      if (updated) saveCollectionItem(updated).catch(() => {});
      return next;
    });
  }, []);

  const clearActiveCollection = useCallback(() => {
    if (!activeCollectionId) return;
    const doomed = collection.filter((i) => i.collectionId === activeCollectionId);
    setCollection((prev) => prev.filter((i) => i.collectionId !== activeCollectionId));
    Promise.all(doomed.map((i) => deleteCollectionItem(i.id))).catch(() => {});
  }, [collection, activeCollectionId]);

  const selectedFields = draft.describe?.fields.filter((f) =>
    draft.selectedFieldNames.has(f.name)
  ) ?? [];

  const singleStep = !state.connected
    ? 0
    : !draft.selectedObject || selectedFields.length === 0
      ? 1
      : !draft.generatedPayload
        ? 2
        : 3;

  return (
    <AppShell
      connected={state.connected}
      instanceUrl={state.instanceUrl}
      apiVersion={state.apiVersion}
      objectCount={state.objectCount}
      connecting={loading.connect}
      onConnectClick={openConnect}
      onDisconnect={handleDisconnect}
      onNavigate={handleNavigate}
      activeMode={state.mode === "single" ? "builder" : state.mode}
      footerVariant={state.mode === "home" ? "full" : "slim"}


      trail={
        state.connected && state.mode !== "home" && state.mode !== "schema" && state.mode !== "explore" ? (
          <Stepper
                steps={
                  state.mode === "composite"
                    ? COMPOSITE_STEPS
                    : state.mode === "soql"
                      ? (queryLang === "sosl" ? SOSL_STEPS : SOQL_STEPS)
                      : state.mode === "graphql"
                        ? GRAPHQL_STEPS
                        : state.mode === "rest"
                          ? REST_STEPS
                          : SINGLE_STEPS
                }
            current={state.mode === "single" ? singleStep : 1}
          />
        ) : null
      }
    >
      <main className={`mx-auto w-full space-y-5 ${state.mode === "schema" ? "px-1 pt-1 pb-1" : "px-5 pt-3 pb-1"}`}>
        {pendingCloseBuilder && (
          <ConfirmDialog
            title={`Close "${builderTabs.find((t) => t.tabId === pendingCloseBuilder)?.name ?? builderTabs.find((t) => t.tabId === pendingCloseBuilder)?.draft.selectedObject?.label ?? "untitled request"}"?`}
            message="Unsaved request work will be lost. This cannot be undone."
            confirmLabel="Close tab"
            onCancel={() => setPendingCloseBuilder(null)}
            onConfirm={() => doCloseBuilderTab(pendingCloseBuilder)}
          />
        )}
        {pendingCloseSchema && (
          <ConfirmDialog
            title={`Close tab "${schemaTabs.find((t) => t.tabId === pendingCloseSchema)?.name ?? "canvas"}"?`}
            message="Its canvas will be deleted. This cannot be undone."
            confirmLabel="Close tab"
            onCancel={() => setPendingCloseSchema(null)}
            onConfirm={() => doCloseSchemaTab(pendingCloseSchema)}
          />
        )}
        {!state.connected ? (
          <>
            <HomeHero
              connected={false}
              loadingConnect={loading.connect}
              connectError={errors.connect}
              onConnect={openConnect}
              onHowItWorks={() => setShowHowItWorks(true)}
              onJumpMode={jumpToMode}
            />
            <HomeZigZag onOpen={openZigZag} />
            <PrivacyBanner />
          </>
        ) : (
          <>
            {/* ── Connected home: the same home hero ── */}
            {state.mode === "home" && (
              <>
                <HomeHero
                  connected
                  loadingConnect={loading.connect}
                  connectError={errors.connect}
                  onConnect={openConnect}
                  onHowItWorks={() => setShowHowItWorks(true)}
                  onJumpMode={jumpToMode}
                />
                <HomeZigZag onOpen={openZigZag} />
                <PrivacyBanner />
              </>
            )}

            {/* ── Builder modes stay mounted (hidden when inactive) so work
                survives tab switches - describe caches, drafts, canvases kept ── */}
            {/* ── Composite mode ── */}
            <div hidden={state.mode !== "composite"}>
              <section id="composite" aria-label="Composite API Builder" className="scroll-mt-20">
                <CompositePanel
                  objects={state.objects}
                  instanceUrl={state.instanceUrl}
                  apiVersion={state.apiVersion}
                  orgKey={orgKey}
                  getToken={() => tokenRef.current}
                  onAddToCollection={requestAddToCollection}
                  collectionCount={collection.length}
                  onOpenCollection={() => setShowCollection(true)}
                  onSessionExpired={handleSessionExpired}
                />
              </section>
            </div>

            {/* ── Org Explorer mode ── */}
            <div hidden={state.mode !== "explore"}>
              <section id="explore" aria-label="Org Explorer" className="scroll-mt-20">
                <ExplorerPanel
                  objects={state.objects}
                  loadingObjects={loading.objects}
                  objectsError={errors.objects}
                  instanceUrl={state.instanceUrl}
                  apiVersion={state.apiVersion}
                  getToken={() => tokenRef.current}
                  onSessionExpired={handleSessionExpired}
                />
              </section>
            </div>

            {/* ── GraphQL mode ── */}
            <div hidden={state.mode !== "graphql"}>
              <section id="graphql" aria-label="GraphQL Query Builder" className="scroll-mt-20">
                <GraphQLPanel
                  objects={state.objects}
                  instanceUrl={state.instanceUrl}
                  apiVersion={state.apiVersion}
                  getToken={() => tokenRef.current}
                  onAddToCollection={requestAddToCollection}
                  collectionCount={collection.length}
                  onOpenCollection={() => setShowCollection(true)}
                  onSessionExpired={handleSessionExpired}
                />
              </section>
            </div>

            {/* ── SOQL mode ── */}
            <div hidden={state.mode !== "soql"}>
              <section id="soql" aria-label="SOQL Query Builder" className="scroll-mt-20">
                <SoqlPanel
                  objects={state.objects}
                  instanceUrl={state.instanceUrl}
                  apiVersion={state.apiVersion}
                  getToken={() => tokenRef.current}
                  onSessionExpired={handleSessionExpired}
                  onLanguageChange={setQueryLang}
                />
              </section>
            </div>

            {/* ── Schema deep-dive mode: tabbed canvases, all mounted, active shown ── */}
            <div hidden={state.mode !== "schema"}>
              {/* Canvas tabs - up to 5 parallel SchemaPanel instances, state kept per tab */}
              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Schema canvases">
                {schemaTabs.map((t) => {
                  const active = (schemaTabs.find((x) => x.tabId === activeSchemaTabId) ?? schemaTabs[0]).tabId === t.tabId;
                  return (
                    <span
                      key={t.tabId}
                      role="tab"
                      aria-selected={active}
                      className={`flex items-center gap-1 rounded-lg border pl-2.5 pr-1 py-1 text-[12px] font-medium transition-colors ${
                        active
                          ? "border-ivory-950 bg-ivory-950 text-ivory-100"
                          : "border-[var(--color-line)] bg-[var(--color-surface)] text-ivory-600 hover:text-ivory-950"
                      }`}
                    >
                      {renamingSchemaTabId === t.tabId ? (
                        <input
                          autoFocus
                          defaultValue={t.name}
                          onBlur={(e) => renameSchemaTab(t.tabId, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setRenamingSchemaTabId(null);
                          }}
                          aria-label="Canvas name"
                          className="w-28 rounded border border-bronze-500 px-1 py-0.5 text-[12px] text-ivory-950 focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActiveSchemaTabId(t.tabId)}
                          onDoubleClick={() => setRenamingSchemaTabId(t.tabId)}
                          title="Switch canvas (double-click to rename)"
                          className="max-w-[160px] truncate cursor-pointer"
                        >
                          {t.name}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => closeSchemaTab(t.tabId)}
                        aria-label={`Close ${t.name}`}
                        title="Close canvas"
                        className={`rounded px-1 cursor-pointer ${active ? "hover:bg-white/20" : "hover:bg-ivory-200"}`}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
                <Button
                  size="sm"
                  onClick={addSchemaTab}
                  disabled={schemaTabs.length >= MAX_SCHEMA_TABS}
                  title={schemaTabs.length >= MAX_SCHEMA_TABS ? `Up to ${MAX_SCHEMA_TABS} canvases` : "Open a new blank canvas (keeps current work)"}
                >
                  + New tab
                </Button>
              </div>
              <section id="schema" aria-label="Schema Deep Dive" className="scroll-mt-20">
                {schemaTabs.map((t) => {
                  const active = (schemaTabs.find((x) => x.tabId === activeSchemaTabId) ?? schemaTabs[0]).tabId === t.tabId;
                  return (
                    <div key={t.tabId} hidden={!active}>
                      <SchemaPanel
                        objects={state.objects}
                        instanceUrl={state.instanceUrl}
                        apiVersion={state.apiVersion}
                        orgKey={orgKey}
                        tabId={t.tabId}
                        tabName={t.name}
                        shareId={active ? shareId : null}
                        onShareConsumed={() => setShareId(null)}
                        pendingNav={schemaNav && schemaNav.tabId === t.tabId ? schemaNav : null}
                        onNavConsumed={() => setSchemaNav(null)}
                        onRequestTab={handleRequestTab}
                        getToken={() => tokenRef.current}
                        onSessionExpired={handleSessionExpired}
                      />
                    </div>
                  );
                })}
              </section>
            </div>

            {/* ── REST explorer mode ── */}
            <div hidden={state.mode !== "rest"}>
              <section id="rest" aria-label="REST API Explorer" className="scroll-mt-20">
                <RestExplorerPanel
                  instanceUrl={state.instanceUrl}
                  apiVersion={state.apiVersion}
                  getToken={() => tokenRef.current}
                  onAddToCollection={requestAddToCollection}
                  collectionCount={collection.length}
                  onOpenCollection={() => setShowCollection(true)}
                  onSessionExpired={handleSessionExpired}
                />
              </section>
            </div>

            {/* ── Anonymous Apex mode ── */}
            <div hidden={state.mode !== "apex"}>
              <section id="apex" aria-label="Anonymous Apex Runner" className="scroll-mt-20">
                <ApexPanel
                  instanceUrl={state.instanceUrl}
                  apiVersion={state.apiVersion}
                  getToken={() => tokenRef.current}
                  onSessionExpired={handleSessionExpired}
                />
              </section>
            </div>

            {/* ── Event monitor mode ── */}
            <div hidden={state.mode !== "events"}>
              <section id="events" aria-label="Event Monitor" className="scroll-mt-20">
                <EventMonitorPanel
                  active={state.mode === "events"}
                  instanceUrl={state.instanceUrl}
                  apiVersion={state.apiVersion}
                  getToken={() => tokenRef.current}
                  onSessionExpired={handleSessionExpired}
                />
              </section>
            </div>

            {/* ── Webhooks console mode ── */}
            <div hidden={state.mode !== "webhooks"}>
              <section id="webhooks" aria-label="Webhooks Console" className="scroll-mt-20">
                <WebhooksPanel
                  active={state.mode === "webhooks"}
                  instanceUrl={state.instanceUrl}
                  apiVersion={state.apiVersion}
                  getToken={() => tokenRef.current}
                  onSessionExpired={handleSessionExpired}
                />
              </section>
            </div>

            {/* ── Single object mode: request tabs + panels stack tight ── */}
            {state.mode === "single" && (
              <div className="space-y-3">
              {/* Request tabs - up to 10 full drafts side by side, state kept per tab */}
              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Open requests">
                {builderTabs.map((t, i) => {
                  const active = t.tabId === activeBuilderTabRef.current;
                  const label = t.name ?? t.draft.selectedObject?.label ?? `Request ${i + 1}`;
                  const dirty = t.draft.selectedObject !== null || t.draft.selectedFieldNames.size > 0;
                  return (
                    <span
                      key={t.tabId}
                      role="tab"
                      aria-selected={active}
                      className={`flex items-center gap-1 rounded-lg border pl-2.5 pr-1 py-1 text-[12px] font-medium transition-colors ${
                        active
                          ? "border-ivory-950 bg-ivory-950 text-ivory-100"
                          : "border-[var(--color-line)] bg-[var(--color-surface)] text-ivory-600 hover:text-ivory-950"
                      }`}
                    >
                      {renamingBuilderTabId === t.tabId ? (
                        <input
                          autoFocus
                          defaultValue={label}
                          onBlur={(e) => renameBuilderTab(t.tabId, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setRenamingBuilderTabId(null);
                          }}
                          aria-label="Request name"
                          className="w-28 rounded border border-bronze-500 px-1 py-0.5 text-[12px] text-ivory-950 focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => switchBuilderTab(t.tabId)}
                          onDoubleClick={() => setRenamingBuilderTabId(t.tabId)}
                          title="Switch request (double-click to rename)"
                          className="max-w-[160px] truncate cursor-pointer"
                        >
                          {dirty ? "● " : ""}{label}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => closeBuilderTab(t.tabId)}
                        aria-label={`Close ${label}`}
                        title="Close request"
                        className={`rounded px-1 cursor-pointer ${active ? "hover:bg-white/20" : "hover:bg-ivory-200"}`}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
                <Button
                  size="sm"
                  onClick={addBuilderTab}
                  disabled={builderTabs.length >= MAX_BUILDER_TABS}
                  title={builderTabs.length >= MAX_BUILDER_TABS ? `Up to ${MAX_BUILDER_TABS} open requests` : "Open a new request tab (keeps current work)"}
                >
                  + New request
                </Button>
                <CollectionTrayButton count={collection.length} onOpen={() => setShowCollection(true)} />
              </div>
              <section id="builder" aria-label="Object and Field Selection" className="scroll-mt-20">
                <div className="flex gap-1">
                  <BuilderRail
                    items={[
                      { id: "object", label: "Object", open: builderLeftOpen, onToggle: () => setBuilderLeftOpen((v) => !v) },
                      { id: "fields", label: "Fields", open: builderRightOpen, onToggle: () => setBuilderRightOpen((v) => !v) },
                      { id: "payload", label: "Payload", open: builderPayloadOpen, onToggle: () => setBuilderPayloadOpen((v) => !v) },
                      { id: "test", label: "Test", open: builderTestOpen, onToggle: () => setBuilderTestOpen((v) => !v) },
                    ]}
                    payloadAvailable={state.connected && selectedFields.length > 0}
                    testAvailable={Boolean(draft.generatedPayload)}
                  />
                  <div className="min-w-0 flex-1 space-y-5">
                  {(builderLeftOpen || builderRightOpen) && (
                    <div className={`grid min-h-0 gap-1 ${builderGridClass(builderLeftOpen, builderRightOpen)}`}>
                    <div className="flex min-h-0 flex-col">
                      {builderLeftOpen && (
                      <div className="flex min-h-0 flex-1 flex-col">
                      <ObjectPanel
                        objects={state.objects}
                        selectedObject={draft.selectedObject}
                        loading={loading.objects}
                        error={errors.objects}
                        onSelect={handleObjectSelect}
                      />
                      </div>
                      )}
                    </div>

                    <div className="flex min-h-0 flex-col">
                      {builderRightOpen && (
                      <div className="flex min-h-0 flex-1 flex-col">
                    {draft.selectedObject ? (
                      <FieldPanel
                        fields={draft.describe?.fields ?? []}
                        selectedFieldNames={draft.selectedFieldNames}
                        operation={draft.operation}
                        loading={loading.describe}
                        error={errors.describe}
                        objectName={draft.selectedObject.name}
                        objectLabel={draft.selectedObject.label}
                        onToggleField={handleToggleField}
                        onSelectAll={handleSelectAll}
                        onClearAll={handleClearAll}
                      />
                    ) : (
                      <div className="arch-card flex h-full min-h-0 flex-1 flex-col items-center justify-center px-6 py-8 text-center">
                        <svg width="300" height="132" viewBox="0 0 300 132" fill="none" aria-hidden="true" className="h-auto w-[280px] max-w-full">
                          <rect x="14" y="26" width="92" height="80" rx="10" fill="#FAF8F2" stroke="#722F37" strokeWidth="2" />
                          <line x1="28" y1="48" x2="92" y2="48" stroke="#722F37" strokeWidth="5" strokeLinecap="round" />
                          <line x1="28" y1="64" x2="92" y2="64" stroke="#C9A86A" strokeWidth="5" strokeLinecap="round" />
                          <line x1="28" y1="80" x2="78" y2="80" stroke="#C9A86A" strokeWidth="5" strokeLinecap="round" />
                          <line x1="106" y1="46" x2="150" y2="30" stroke="#A98450" strokeWidth="1.5" strokeDasharray="4 3" />
                          <line x1="106" y1="66" x2="150" y2="66" stroke="#A98450" strokeWidth="1.5" strokeDasharray="4 3" />
                          <line x1="106" y1="86" x2="150" y2="102" stroke="#A98450" strokeWidth="1.5" strokeDasharray="4 3" />
                          <rect x="150" y="18" width="136" height="24" rx="12" fill="#FFFFFF" stroke="#C9A86A" strokeWidth="1.5" />
                          <circle cx="164" cy="30" r="4" fill="#4E342E" />
                          <line x1="174" y1="30" x2="272" y2="30" stroke="#E3D9C6" strokeWidth="5" strokeLinecap="round" />
                          <rect x="150" y="54" width="136" height="24" rx="12" fill="#FFFFFF" stroke="#C9A86A" strokeWidth="1.5" />
                          <circle cx="164" cy="66" r="4" fill="#722F37" />
                          <line x1="174" y1="66" x2="272" y2="66" stroke="#E3D9C6" strokeWidth="5" strokeLinecap="round" />
                          <rect x="150" y="90" width="136" height="24" rx="12" fill="#FFFFFF" stroke="#C9A86A" strokeWidth="1.5" />
                          <circle cx="164" cy="102" r="4" fill="#4E342E" />
                          <line x1="174" y1="102" x2="258" y2="102" stroke="#E3D9C6" strokeWidth="5" strokeLinecap="round" />
                        </svg>
                        <h3 className="mt-4 text-sm font-semibold text-ivory-950">Select an object to describe its fields</h3>
                        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ivory-600">Pick any standard or custom sObject - or press ⌘K to jump straight to it. Field types, picklists and writability load live from your org.</p>
                        <div className="mt-4">
                          <Button variant="secondary" size="sm" onClick={() => setShowSearch(true)}>
                            Find objects ⌘K
                          </Button>
                        </div>
                      </div>
                    )}
                      </div>
                      )}
                    </div>
                    </div>
                    )}

                  {/* Step 3: Payload values */}
                  {state.connected && selectedFields.length > 0 && builderPayloadOpen && (
                  <section aria-label="Payload Configuration">
                    <PayloadPanel
                      selectedFields={selectedFields}
                      fieldValues={draft.fieldValues}
                      operation={draft.operation}
                      recordId={draft.recordId}
                      onFieldValueChange={handleFieldValueChange}
                      onOperationChange={handleOperationChange}
                      onRecordIdChange={handleRecordIdChange}
                      onGeneratePayload={handleGeneratePayload}
                      onGenerateSamples={handleGenerateSamples}
                    />
                  </section>
                  )}

                  {/* Step 4: Export + save to collection - visible as soon as a
                      payload exists. Deliberately NOT gated on the Test toggle:
                      collapsing Test used to hide the only "+ Collection" save
                      button in the builder. */}
                  {draft.generatedPayload && (
                  <section aria-label="Export">
                    <ExportPanel generatedPayload={draft.generatedPayload} onAddToCollection={requestAddToCollection} collectionCount={collection.length} onOpenCollection={() => setShowCollection(true)} />
                  </section>
                  )}

                  {/* Step 5: Test request */}
                  {draft.generatedPayload && builderTestOpen && (
                  <section aria-label="Test Request">
                    <RequestPanel
                      key={activeBuilderTab.tabId}
                      generatedPayload={draft.generatedPayload}
                      instanceUrl={state.instanceUrl}
                      apiVersion={state.apiVersion}
                      getToken={() => tokenRef.current}
                      onSessionExpired={handleSessionExpired}
                    />
                  </section>
                  )}
                  </div>
                </div>
              </section>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Overlays ── */}
      <SessionExpiredModal
        open={sessionExpired && state.connected}
        instanceUrl={state.instanceUrl}
        onReconnect={() => {
          setSessionExpired(false);
          openConnect();
        }}
        onDisconnect={handleDisconnect}
      />
      {bootShown && (
        <BootLoader
          stage={state.connected ? "objects" : "connect"}
          fading={bootFade}
        />
      )}
      <CollectionPicker
        item={pickerItem}
        collections={collections}
        items={collection}
        onConfirm={confirmAddToCollection}
        onCreateAndConfirm={createCollectionAndAdd}
        onClose={() => setPickerItem(null)}
      />
      <CollectionDrawer
        open={showCollection}
        collections={collections}
        activeCollectionId={activeCollectionId}
        items={collection}
        onClose={() => setShowCollection(false)}
        onSwitch={setActiveCollectionId}
        onCreate={createCollection}
        onRename={renameCollection}
        onDelete={deleteCollectionHandler}
        onRemove={removeFromCollection}
        onRenameItem={renameCollectionItem}
        onClearActive={clearActiveCollection}
      />
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 rounded-full bg-ivory-950 text-ivory-100 pl-3 pr-4 py-2 text-xs font-medium shadow-xl"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-[11px]" aria-hidden="true">✓</span>
          {toast}
          <button
            type="button"
            onClick={() => {
              setToast(null);
              setShowCollection(true);
            }}
            className="underline underline-offset-2 hover:text-bronze-200 cursor-pointer"
          >
            Review
          </button>
        </div>
      )}
      <HowItWorksModal
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        onConnect={openConnect}
      />
      <WelcomeModal
        open={showWelcome && !state.connected}
        onConnect={openConnect}
        onExplore={() => {
          setShowWelcome(false);
          sessionStorage.setItem("sf_welcomed", "1");
        }}
      />
      <ConnectModal
        open={showConnect}
        loading={loading.connect}
        error={errors.connect}
        initialInstanceUrl={savedCreds.instanceUrl}
        initialToken={savedCreds.token}
        initialApiVersion={savedCreds.apiVersion}
        onClose={() => { if (!loading.connect) setShowConnect(false); }}
        onConnect={handleConnect}
      />
      {showSearch && state.objects.length > 0 && (
        <ObjectSearchOverlay
          objects={state.objects}
          onSelect={handleObjectSelect}
          onClose={() => setShowSearch(false)}
        />
      )}
    </AppShell>
  );
}
