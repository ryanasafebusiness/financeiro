import * as React from "react";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
 * OTP Input — uma célula por dígito.
 *
 * A lógica (`useOtpInput`) é adaptada do "OTP Input" do 21st.dev (@ddoemonn):
 * colar um código inteiro, backspace que volta uma célula, setas/Home/End e
 * foco automático na primeira célula vazia. Reescrito sem motion/react — as
 * animações são CSS — e sem React 19 (`ref` como prop): aqui é forwardRef.
 * ------------------------------------------------------------------------ */

export type OtpMode = "numeric" | "alphanumeric";

const ALLOW: Record<OtpMode, RegExp> = {
  numeric: /^[0-9]$/,
  alphanumeric: /^[0-9a-zA-Z]$/,
};

export type OtpStatus = "idle" | "error" | "success";

export type OtpInputHandle = {
  clear: () => void;
  focus: () => void;
};

type UseOtpInputOptions = {
  length?: number;
  mode?: OtpMode;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
};

function useOtpInput({
  length = 6,
  mode = "numeric",
  disabled = false,
  onChange,
  onComplete,
}: UseOtpInputOptions) {
  const allow = ALLOW[mode];

  const keep = React.useCallback(
    (text: string) => text.split("").filter((c) => allow.test(c)).join(""),
    [allow]
  );

  const [chars, setChars] = React.useState<string[]>(() =>
    Array.from({ length }, () => "")
  );
  const [focusedIndex, setFocusedIndex] = React.useState(-1);

  const charsRef = React.useRef(chars);
  charsRef.current = chars;
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);

  const changed = React.useRef(onChange);
  changed.current = onChange;
  const completed = React.useRef(onComplete);
  completed.current = onComplete;

  const commit = React.useCallback((next: string[]) => {
    charsRef.current = next;
    setChars(next);
    const value = next.join("");
    changed.current?.(value);
    if (next.length > 0 && next.every((c) => c !== "")) completed.current?.(value);
  }, []);

  const focusAt = React.useCallback(
    (index: number) => {
      const el = refs.current[Math.max(0, Math.min(length - 1, index))];
      if (!el) return;
      el.focus();
      el.select();
    },
    [length]
  );

  /** Distribui um texto colado a partir de uma célula. */
  const fillFrom = React.useCallback(
    (index: number, text: string) => {
      const incoming = keep(text);
      if (!incoming) return;
      const next = [...charsRef.current];
      let cursor = index;
      for (const c of incoming) {
        if (cursor >= length) break;
        next[cursor] = c;
        cursor += 1;
      }
      commit(next);
      focusAt(cursor);
    },
    [commit, focusAt, keep, length]
  );

  const clear = React.useCallback(() => {
    commit(Array.from({ length }, () => ""));
    focusAt(0);
  }, [commit, focusAt, length]);

  const getCellProps = React.useCallback(
    (index: number) => ({
      ref: (el: HTMLInputElement | null) => {
        refs.current[index] = el;
      },
      value: chars[index] ?? "",
      disabled,
      type: "text" as const,
      inputMode: (mode === "numeric" ? "numeric" : "text") as "numeric" | "text",
      // Só a primeira célula pede o código do SMS/WhatsApp ao sistema.
      autoComplete: index === 0 ? "one-time-code" : "off",
      autoCorrect: "off" as const,
      autoCapitalize: "off" as const,
      spellCheck: false,
      maxLength: 1,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const previous = charsRef.current[index] ?? "";
        const raw = e.currentTarget.value;
        // Digitar por cima de um dígito existente troca em vez de concatenar.
        const trimmed =
          raw.length > 1 && previous && raw.startsWith(previous)
            ? raw.slice(previous.length)
            : raw;
        const incoming = keep(trimmed);

        if (incoming.length === 0) {
          if (raw.length === 0 && previous) {
            const next = [...charsRef.current];
            next[index] = "";
            commit(next);
          }
          e.currentTarget.value = charsRef.current[index] ?? "";
          return;
        }
        if (incoming.length === 1) {
          const next = [...charsRef.current];
          next[index] = incoming;
          e.currentTarget.value = incoming;
          commit(next);
          if (index < length - 1) focusAt(index + 1);
          return;
        }
        fillFrom(index, incoming);
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace") {
          e.preventDefault();
          const current = charsRef.current;
          const next = [...current];
          if (current[index]) {
            next[index] = "";
            commit(next);
            return;
          }
          if (index > 0) {
            next[index - 1] = "";
            commit(next);
            focusAt(index - 1);
          }
          return;
        }
        if (e.key === "Delete") {
          e.preventDefault();
          const next = [...charsRef.current];
          next[index] = "";
          commit(next);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          focusAt(index - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          focusAt(index + 1);
        } else if (e.key === "Home") {
          e.preventDefault();
          focusAt(0);
        } else if (e.key === "End") {
          e.preventDefault();
          focusAt(length - 1);
        }
      },
      onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const text = keep(e.clipboardData.getData("text"));
        fillFrom(text.length >= length ? 0 : index, text);
      },
      onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
        e.currentTarget.select();
        // Não deixa pular células: cai sempre na primeira vazia.
        const firstEmpty = charsRef.current.findIndex((c) => c === "");
        if (firstEmpty !== -1 && firstEmpty < index) {
          focusAt(firstEmpty);
          return;
        }
        setFocusedIndex(index);
      },
      onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
        const to = e.relatedTarget as HTMLInputElement | null;
        if (to && refs.current.includes(to)) return;
        setFocusedIndex(-1);
      },
    }),
    [chars, commit, disabled, fillFrom, focusAt, keep, length, mode]
  );

  return { chars, focusedIndex, getCellProps, focusAt, clear };
}

export interface OtpInputProps {
  length?: number;
  mode?: OtpMode;
  status?: OtpStatus;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Insere um respiro visual a cada N células (0 desliga). */
  groupEvery?: number;
  label?: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
  className?: string;
}

export const OtpInput = React.forwardRef<OtpInputHandle, OtpInputProps>(
  (
    {
      length = 6,
      mode = "numeric",
      status = "idle",
      disabled = false,
      autoFocus = false,
      groupEvery = 3,
      label = "Código de verificação",
      onChange,
      onComplete,
      className,
    },
    ref
  ) => {
    const { chars, focusedIndex, getCellProps, focusAt, clear } = useOtpInput({
      length,
      mode,
      disabled,
      onChange,
      onComplete,
    });

    const error = status === "error";
    const success = status === "success";
    const wasError = React.useRef(false);

    React.useImperativeHandle(ref, () => ({ clear, focus: () => focusAt(0) }), [
      clear,
      focusAt,
    ]);

    React.useEffect(() => {
      if (autoFocus && !disabled) focusAt(0);
    }, [autoFocus, disabled, focusAt]);

    // Código errado devolve o foco ao início — o usuário digita de novo direto.
    React.useEffect(() => {
      if (error && !wasError.current && !disabled) focusAt(0);
      wasError.current = error;
    }, [error, disabled, focusAt]);

    return (
      <div
        role="group"
        aria-label={label}
        className={cn("flex justify-center gap-2", error && "animate-shake", className)}
      >
        {Array.from({ length }, (_, i) => {
          const char = chars[i] ?? "";
          const active = focusedIndex === i;
          const gap = groupEvery > 0 && i > 0 && i % groupEvery === 0;

          return (
            <div key={i} className={cn("relative h-14 w-11", gap && "ml-3")}>
              <input
                {...getCellProps(i)}
                aria-label={`${label}, dígito ${i + 1} de ${length}`}
                aria-invalid={error || undefined}
                className={cn(
                  "h-14 w-11 rounded-md border bg-card text-center text-transparent caret-transparent shadow-xs outline-none",
                  "transition-[border-color,box-shadow,background-color] duration-fast ease-out-soft",
                  "selection:bg-transparent disabled:cursor-not-allowed disabled:opacity-50",
                  error
                    ? "border-negative ring-4 ring-negative/10"
                    : success
                      ? "border-positive ring-4 ring-positive/10"
                      : active
                        ? "border-primary ring-4 ring-primary/[0.12]"
                        : char
                          ? "border-border-strong"
                          : "border-input bg-muted/50"
                )}
              />

              {/* Camada visual: o input é transparente e quem aparece é isto,
                  para o dígito poder animar sem mexer no valor do campo. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 grid place-items-center"
              >
                {char ? (
                  <span
                    key={char}
                    className="animate-fade-up text-xl font-semibold tabular text-foreground"
                  >
                    {char}
                  </span>
                ) : active && !disabled ? (
                  <span className="block h-5 w-px animate-caret rounded-full bg-foreground" />
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
);
OtpInput.displayName = "OtpInput";
