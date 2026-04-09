/**
 * SMART PHASE PREMIUM 01 — Premium Writer 2.0
 * AI-slop signatures in Russian Instagram captions.
 *
 * These are concrete patterns that immediately mark a caption as
 * AI-generated and destroy reader trust. Captured from analyzing
 * 6 failed Sonnet 4 outputs in the Marina Nails test.
 *
 * The block is INJECTED INTO THE SYSTEM PROMPT and serves as a
 * deterministic anti-pattern guide. Combined with positive examples
 * (reference captions) and the slop detector regex, this is our
 * 3-layer defense against distributional convergence.
 */

export const ANTI_SLOP_RU = `# Маркеры AI-slop в русскоязычных Instagram captions

Эти конструкции немедленно выдают AI-generated текст и убивают доверие читателя.
Caption содержащий любую из них = failed caption, переписать.

## Конструкция "это не X, а Y" — самый частый AI signature

Любая фраза вида "это не [препятствие], а [решение]":
- "не случайность, а результат"
- "не сказка, а реальность"
- "не магия, а техника"
- "не удача, а профессионализм"
- "не фантазия, а..."

ЗАПРЕЩЕНО полностью эта риторическая фигура. Это самый яркий маркер LLM-text.

## Generic abstract noun constructions

- "залог стойкости / красоты / комфорта / успеха"
- "результат правильной техники / подхода / работы"
- "профессиональный подход / стандарт / уровень"
- "качество и комфорт"
- "ваш стиль / ритм жизни / индивидуальность"
- "истинная элегантность"
- "ваше преображение"
- "новый уровень красоты"
- "уникальная техника / методика / подход"
- "эксклюзивный сервис"

## Generic CTAs (рекламные шаблоны)

- "Запишитесь и оцените сами"
- "Хотите узнать больше?"
- "Запись в Direct"
- "Узнайте подробнее"
- "Не упустите шанс"
- "Доверьте свои ногти профессионалам"
- "Записывайтесь сейчас"
- "Подарите себе [что-то]"

## Generic openings (банальные заходы)

- "Знаете ли вы что..."
- "Все мечтают о..."
- "Каждая женщина заслуживает..."
- "Идеальный маникюр — это..."
- "Хотите чтобы..."

## Replacement strategies (что использовать вместо)

- ВМЕСТО "не X, а Y" → конкретная сцена или сенсорная деталь
- ВМЕСТО "результат правильной техники" → конкретное число/время/материал
- ВМЕСТО "запишитесь и оцените" → конкретный specific ask ("напиши ДИЗАЙН в Direct")
- ВМЕСТО "знаете ли вы что..." → конкретный момент во времени или место
- ВМЕСТО "ваш стиль" → имя реальной клиентки и её ситуация

## Critical rule

Premium copy описывает КОНКРЕТНЫЕ вещи КОНКРЕТНЫМИ словами.
Абстракции = slop. Числа, имена, объекты, моменты времени = premium.

Если ты пишешь "профессиональный подход" — переписывай.
Если ты пишешь "245 грит, движения от основания" — это premium.
`;
