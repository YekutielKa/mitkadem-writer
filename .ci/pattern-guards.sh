#!/usr/bin/env bash
# ============================================================================
# pattern-guards.sh — машинные стражи паттернов Mitkadem для БЭКЕНД-сервиса
# (ARCHITECT_KIT, часть D; поставлен нарядом Обн-213).
#
# Существующие нарушения зафиксированы в .ci/guards-baseline.txt
# ("<GUARD_ID>|<путь файла>") — по ним только WARNING; нарушение в НОВОМ
# файле — FAIL (exit 1). Снял нарушение — удали строку из baseline тем же PR.
# Каждый страж печатает, где про это читать в ките:
# канон-репо mitkadem-system_docs → architect_kit/.
# ============================================================================
set -u
BASE="$(dirname "$0")/guards-baseline.txt"
[ -f "$BASE" ] || BASE=/dev/null
CNT="$(mktemp -d)"; trap 'rm -rf "$CNT"' EXIT
: > "$CNT/fails"; : > "$CNT/warns"

check() { # $1=ID $2=описание $3=ссылка; stdin = строки git grep (file:line:...)
  local id="$1" msg="$2" ref="$3" hits line file key
  hits="$(cat)"
  [ -z "$hits" ] && return 0
  while IFS= read -r line; do
    file="${line%%:*}"; key="$id|$file"
    if grep -qxF "$key" "$BASE"; then
      echo "⚠️  [$id][baseline] $line"; echo "$key" >> "$CNT/warns"
    else
      echo "❌ [$id][НОВОЕ] $line"; echo "$key" >> "$CNT/fails"
    fi
  done <<< "$hits"
  echo "   → $msg. Читать: $ref"
}

X=(':!node_modules' ':!*node_modules*' ':!dist' ':!build' ':!.next' ':!*.lock' ':!package-lock.json' ':!.ci' ':!*.bak*' ':!*backup*' ':!*.stop-fix*' ':!*.orig' ':!*.log' ':!EVIDENCE' ':!*/EVIDENCE/*')

# S1 — AUTH_BYPASS: флагов, отключающих auth, не существует (Обн-191 C22).
git grep -nI 'AUTH_BYPASS' -- "${X[@]}" 2>/dev/null \
  | check S1 'AUTH_BYPASS в коде/дефолтах запрещён' 'architect_kit/05_SECURITY_GUARDRAILS.md §2'

# S2 — прямая строка подключения postgres с кредами литералом в коде.
#      Рантайм — только env через PgBouncer; прямой switchback — только env DIRECT_URL.
git grep -nIE 'postgres(ql)?://[^"'"'"'`$ <]*:[^"'"'"'`$ <]*@' -- "${X[@]}" 2>/dev/null \
  | grep -vi 'REDACTED\|example\|localhost\|127\.0\.0\.1\|user:pass' \
  | check S2 'постгрес-URL с кредами литералом — только env (пулер; DIRECT_URL для миграций)' 'architect_kit/03_IMPLEMENTOR_PATTERNS.md П4'

# S3 — секрет-подобные литералы (sk-/whsec_/EAA/длинный hex).
git grep -nIE '["'"'"'](sk-[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}|EAA[A-Za-z0-9]{40,}|[0-9a-f]{48,})["'"'"']' -- "${X[@]}" 2>/dev/null \
  | grep -vi 'test\|spec\|fixture\|example\|snapshot' \
  | check S3 'похоже на секрет в коде — секреты только в Railway env' 'architect_kit/05_SECURITY_GUARDRAILS.md §1, KEY_REGISTRY.md'

# S4 — атрибуция LLM-трат: вызов ledger-эндпоинта llm-hub ОБЯЗАН нести x-activity
#      (хаб читает x-activity, НЕ x-flow; иначе трата падает в (no_activity)/
#      "(unattributed — legacy)"). Ledger-эндпоинты = generate|image|gemini-image|
#      transcribe|score (создают строку LlmGeneration). Read-эндпоинты (spend*|
#      stats|models|health) и вызовы к другим сервисам — не в счёт. SPEND_HYGIENE.
{
  for f in $(git grep -lIE '/v1/llm/(generate|image|gemini-image|transcribe|score)' -- "${X[@]}" 2>/dev/null); do
    grep -q 'x-activity' "$f" && continue
    git grep -nIE '/v1/llm/(generate|image|gemini-image|transcribe|score)' -- "$f" 2>/dev/null | head -1
  done
} | check S4 'вызов llm-hub без x-activity — трата станет unattributed (передай canonical activity)' 'architect_kit/05_SECURITY_GUARDRAILS.md §7 (LLM-атрибуция)'

FAILS=$(wc -l < "$CNT/fails"); WARNS=$(wc -l < "$CNT/warns")
echo
echo "Стражи: FAIL=$FAILS (новые), WARN=$WARNS (baseline)"
[ "$FAILS" -gt 0 ] && { echo '🔴 Новые нарушения — ссылки выше (architect_kit).'; exit 1; }
echo '🟢 Новых нарушений нет.'
exit 0
