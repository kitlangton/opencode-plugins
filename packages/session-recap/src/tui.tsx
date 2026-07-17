/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/v2/tui";
import { useRenderer } from "@opentui/solid";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { AUTO_RECAP_AWAY_MS, automaticRecapEligible } from "./eligibility";

const RECAP_PROMPT = [
  "Write one concrete 25-to-40-word sentence recapping the current coding work.",
  "State what changed, was decided, or was learned, then mention the next step only when concrete.",
  "Return only the sentence with no label or Markdown.",
  "Do not mention the recap, session, user, or assistant.",
].join(" ");

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type GenerateSession = (
  input: { sessionID: string; prompt: string },
  options?: { signal?: AbortSignal },
) => Promise<{ text: string }>;

function Recap(props: { context: Plugin.Context; sessionID: string }) {
  const renderer = useRenderer();
  const [loading, setLoading] = createSignal(false);
  const [text, setText] = createSignal<string>();
  const [frame, setFrame] = createSignal(0);
  let blurredAt: number | undefined;
  let lastAutomaticUserID: string | undefined;
  let controller: AbortController | undefined;
  let awayTimer: ReturnType<typeof setTimeout> | undefined;
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;

  const users = () =>
    props.context.data.session.message
      .list(props.sessionID)
      .filter((message) => message.type === "user");

  const revision = () =>
    JSON.stringify({
      messages: props.context.data.session.message.list(props.sessionID),
      pending: props.context.data.session.pending.list(props.sessionID),
    });

  function setGenerating(value: boolean) {
    setLoading(value);
    clearInterval(spinnerTimer);
    spinnerTimer = value
      ? setInterval(
          () => setFrame((current) => (current + 1) % SPINNER_FRAMES.length),
          80,
        )
      : undefined;
  }

  function dismiss(markHandled = true) {
    controller?.abort();
    controller = undefined;
    if (markHandled) lastAutomaticUserID = users().at(-1)?.id;
    setText(undefined);
    setGenerating(false);
  }

  function generate(trigger: "manual" | "automatic") {
    const latest = users().at(-1);
    if (!latest) return;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    setGenerating(true);
    void props.context.client.session
      .wait({ sessionID: props.sessionID }, { signal: request.signal })
      .then(() => {
        const before = revision();
        const session = props.context.client
          .session as typeof props.context.client.session & {
          generate: GenerateSession;
        };
        return session
          .generate(
            { sessionID: props.sessionID, prompt: RECAP_PROMPT },
            { signal: request.signal },
          )
          .then((response) => ({
            before,
            text: response.text.trim().replaceAll(/\s+/g, " "),
          }));
      })
      .then((response) => {
        if (request.signal.aborted) return;
        if (response.before !== revision()) {
          setGenerating(false);
          return;
        }
        if (response.text) setText(response.text);
        setGenerating(false);
        if (response.text && trigger === "automatic")
          lastAutomaticUserID = latest.id;
      })
      .catch(() => {
        if (request.signal.aborted) return;
        setGenerating(false);
      });
  }

  function generateAutomatic(awayMs: number) {
    if (loading()) return;
    if (
      !automaticRecapEligible({
        awayMs,
        userIDs: users().map((message) => message.id),
        lastAutomaticUserID,
      })
    )
      return;
    generate("automatic");
  }

  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "session.recap",
        title: "Generate session recap",
        description: "Generate a transient recap of the current session",
        group: "Session",
        palette: true,
        slash: { name: "recap", arguments: true },
        enabled: () => users().length > 0 && !loading(),
        run: () => generate("manual"),
      },
      {
        id: "session.recap.dismiss",
        title: "Dismiss session recap",
        group: "Session",
        palette: true,
        enabled: () => Boolean(text() || loading()),
        run: () => dismiss(),
      },
    ],
  }));

  onMount(() => {
    const stop = props.context.data.on("session.input.admitted", (event) => {
      if (
        event.data.sessionID !== props.sessionID ||
        event.data.input.type !== "user"
      )
        return;
      dismiss(false);
    });
    const onBlur = () => {
      blurredAt = Date.now();
      clearTimeout(awayTimer);
      awayTimer = setTimeout(() => {
        awayTimer = undefined;
        if (blurredAt === undefined) return;
        generateAutomatic(Date.now() - blurredAt);
      }, AUTO_RECAP_AWAY_MS);
    };
    const onFocus = () => {
      clearTimeout(awayTimer);
      awayTimer = undefined;
      const away = blurredAt === undefined ? 0 : Date.now() - blurredAt;
      blurredAt = undefined;
      generateAutomatic(away);
    };
    renderer.on("blur", onBlur);
    renderer.on("focus", onFocus);
    onCleanup(() => {
      stop();
      clearTimeout(awayTimer);
      renderer.off("blur", onBlur);
      renderer.off("focus", onFocus);
    });
  });

  onCleanup(() => {
    controller?.abort();
    clearInterval(spinnerTimer);
  });

  return (
    <Show when={loading() || text()}>
      <box
        width="100%"
        paddingLeft={3}
        paddingRight={3}
        paddingBottom={1}
        onMouseUp={() => dismiss()}
      >
        <Show
          when={loading()}
          fallback={<text wrapMode="word">Recap: {text()}</text>}
        >
          <text>{SPINNER_FRAMES[frame()]} Generating recap...</text>
        </Show>
      </box>
    </Show>
  );
}

export default Plugin.define({
  id: "kitlangton.session-recap",
  setup(context) {
    context.ui.slot("session.composer.top", (props) => (
      <Recap context={context} sessionID={String(props.sessionID)} />
    ));
  },
});
