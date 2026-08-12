/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode-ai/plugin/tui";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { AUTO_RECAP_AWAY_MS, automaticRecapEligible } from "./eligibility";

const RECAP_PROMPT = [
  "Write one concrete 25-to-40-word sentence recapping the current coding work.",
  "State what changed, was decided, or was learned, then mention the next step only when concrete.",
  "Return only the sentence with no label or Markdown.",
  "Do not mention the recap, session, user, or assistant.",
].join(" ");

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type Recap = {
  text?: string;
  loading?: boolean;
  handledUserID?: string;
};

type RecapState = {
  sessions: Record<string, Recap>;
};

type Update = (mutate: (draft: RecapState) => void) => void;

function Controller(props: { context: Plugin.Context; state: RecapState; update: Update }) {
  const requests = new Map<string, AbortController>();
  const away = new Map<string, { since: number; timer: ReturnType<typeof setTimeout> }>();
  const [focused, setFocused] = createSignal(true);
  let previousActive: string | undefined;

  const users = (sessionID: string) =>
    props.context.data.session.message.list(sessionID).filter((message) => message.type === "user");

  const activeSession = () => {
    const route = props.context.ui.router.current();
    return route.type === "session" ? route.sessionID : undefined;
  };

  const setRecap = (sessionID: string, recap: Partial<Recap>) =>
    props.update((draft) => {
      draft.sessions[sessionID] = { ...draft.sessions[sessionID], ...recap };
    });

  const dismiss = (sessionID: string, markHandled = true) => {
    requests.get(sessionID)?.abort();
    requests.delete(sessionID);
    props.update((draft) => {
      const handledUserID = markHandled ? users(sessionID).at(-1)?.id : draft.sessions[sessionID]?.handledUserID;
      if (!handledUserID) {
        delete draft.sessions[sessionID];
        return;
      }
      draft.sessions[sessionID] = { handledUserID };
    });
  };

  const generate = (sessionID: string) => {
    const latest = users(sessionID).at(-1);
    if (!latest) return;
    requests.get(sessionID)?.abort();
    const request = new AbortController();
    requests.set(sessionID, request);
    setRecap(sessionID, { loading: true });

    void props.context.client.session
      .wait({ sessionID }, { signal: request.signal })
      .then(() => props.context.client.session.generate({ sessionID, prompt: RECAP_PROMPT }, { signal: request.signal }))
      .then((response) => {
        if (requests.get(sessionID) !== request) return;
        const text = response.text.trim().replaceAll(/\s+/g, " ");
        setRecap(sessionID, {
          text: text || undefined,
          loading: false,
          handledUserID: text ? latest.id : props.state.sessions[sessionID]?.handledUserID,
        });
      })
      .catch(() => {
        if (requests.get(sessionID) !== request) return;
        setRecap(sessionID, { loading: false });
      })
      .finally(() => {
        if (requests.get(sessionID) === request) requests.delete(sessionID);
      });
  };

  const generateAutomatic = (sessionID: string, awayMs: number) => {
    if (props.state.sessions[sessionID]?.loading) return;
    if (
      !automaticRecapEligible({
        awayMs,
        userIDs: users(sessionID).map((message) => message.id),
        lastAutomaticUserID: props.state.sessions[sessionID]?.handledUserID,
      })
    )
      return;
    generate(sessionID);
  };

  const markAway = (sessionID: string) => {
    if (away.has(sessionID)) return;
    const since = Date.now();
    away.set(sessionID, {
      since,
      timer: setTimeout(() => {
        away.delete(sessionID);
        generateAutomatic(sessionID, Date.now() - since);
      }, AUTO_RECAP_AWAY_MS),
    });
  };

  const markActive = (sessionID: string) => {
    const entry = away.get(sessionID);
    if (!entry) return;
    clearTimeout(entry.timer);
    away.delete(sessionID);
    generateAutomatic(sessionID, Date.now() - entry.since);
  };

  const clearAway = (sessionID: string) => {
    const entry = away.get(sessionID);
    if (!entry) return;
    clearTimeout(entry.timer);
    away.delete(sessionID);
  };

  createEffect(() => {
    const active = focused() ? activeSession() : undefined;
    const tabs = props.context.ui.tabs.list();
    const sessions = new Set(tabs.map((tab) => tab.sessionID));
    if (active) sessions.add(active);
    if (!props.context.ui.tabs.enabled() && previousActive && previousActive !== active) markAway(previousActive);
    for (const sessionID of sessions) {
      if (sessionID === active) markActive(sessionID);
      else markAway(sessionID);
    }
    if (props.context.ui.tabs.enabled())
      for (const sessionID of away.keys()) if (!sessions.has(sessionID)) clearAway(sessionID);
    if (active) previousActive = active;
  });

  props.context.keymap.layer(() => {
    const sessionID = activeSession();
    return {
      mode: "global",
      commands: [
        {
          id: "session.recap",
          title: "Generate session recap",
          description: "Generate a transient recap of the current session",
          group: "Session",
          palette: true,
          slash: { name: "recap" },
          enabled: Boolean(sessionID && users(sessionID).length > 0 && !props.state.sessions[sessionID]?.loading),
          run: () => {
            if (sessionID) generate(sessionID);
          },
        },
        {
          id: "session.recap.dismiss",
          title: "Dismiss session recap",
          group: "Session",
          palette: true,
          enabled: Boolean(sessionID && (props.state.sessions[sessionID]?.text || props.state.sessions[sessionID]?.loading)),
          run: () => {
            if (sessionID) dismiss(sessionID);
          },
        },
      ],
    };
  });

  onMount(() => {
    const stop = props.context.data.on("session.input.admitted", (event) => {
      if (event.data.input.type === "user") dismiss(event.data.sessionID, false);
    });
    const onBlur = () => setFocused(false);
    const onFocus = () => setFocused(true);
    props.context.renderer.on("blur", onBlur);
    props.context.renderer.on("focus", onFocus);
    onCleanup(() => {
      stop();
      props.context.renderer.off("blur", onBlur);
      props.context.renderer.off("focus", onFocus);
      for (const entry of away.values()) clearTimeout(entry.timer);
      away.clear();
      for (const request of requests.values()) request.abort();
      requests.clear();
    });
  });

  return <></>;
}

function View(props: { context: Plugin.Context; recap?: Recap }) {
  const [frame, setFrame] = createSignal(0);
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;

  const setGenerating = (loading: boolean | undefined) => {
    clearInterval(spinnerTimer);
    spinnerTimer = loading
      ? setInterval(() => setFrame((current) => (current + 1) % SPINNER_FRAMES.length), 80)
      : undefined;
  };

  createEffect(() => setGenerating(props.recap?.loading));
  onCleanup(() => clearInterval(spinnerTimer));

  return (
    <Show when={props.recap?.loading || props.recap?.text}>
      <box
        width="100%"
        paddingLeft={3}
        paddingRight={3}
        paddingBottom={1}
        onMouseUp={() => props.context.keymap.dispatch("session.recap.dismiss")}
      >
        <Show when={props.recap?.loading} fallback={<text wrapMode="word">Recap: {props.recap?.text}</text>}>
          <text>{SPINNER_FRAMES[frame()]} Generating recap...</text>
          <Show when={props.recap?.text}>
            <text fg={props.context.theme.text.subdued} wrapMode="word">
              Recap: {props.recap?.text}
            </text>
          </Show>
        </Show>
      </box>
    </Show>
  );
}

export default Plugin.define({
  id: "kit.session-recap",
  setup(context) {
    const [state, update] = context.storage.memory("recaps-v2", {
      initial: { sessions: {} as Record<string, Recap> },
    });
    context.ui.slot({ append: "app", render: () => <Controller context={context} state={state} update={update} /> });
    context.ui.slot({
      append: "session.composer.top",
      render: (props) => (
        <View context={context} recap={state.sessions[props.sessionID]} />
      ),
    });
  },
});
