# Task: HACKATHON-VISUAL-OVERHAUL-001

**Sprint:** Sprint 4 (Apr 26 – May 4)
**Status:** PLANNED
**Priority:** Medium — визуальное усиление после функционального обновления

---

## Goal

Обновить play.html до карусели с табами и анимированными иллюстрациями для каждого use case.

---

## Assets (готовы)

Четыре PNG иллюстрации в стиле dark game art / teal glow:
- `web/public/assets/use-case-loot.png` — открытый сундук с teal свечением
- `web/public/assets/use-case-airdrop.png` — парашют с кристаллом
- `web/public/assets/use-case-raffle.png` — ящик с частицами (нужно сгенерировать)
- `web/public/assets/use-case-prediction.png` — октаэдр с ✓/✗

Keeper mascot анимация — нужно сгенерировать через Sora (вращение 360°).

---

## Design Spec

### play.html — карусель

```
[ 🎟 Raffle ]  [ 🪂 Airdrop ]  [ 🎁 Loot ]  [ 🔮 Prediction ]
────────────────────────────────────────────────────────────
     [  иллюстрация use case  ]   подпись TX
     [  кнопки Verify / Build  ]
     [  ←  стрелки  →  ]
```

- Переключение: клик на таб ИЛИ стрелки ИЛИ свайп (mobile)
- Анимация переключения: slide left/right
- CSS анимации на иллюстрациях:
  - Loot: `float` вверх-вниз + glow пульсация
  - Airdrop: `sway` покачивание + float
  - Raffle: `float` + sparkle частицы
  - Prediction: медленное вращение по оси Y

### Keeper mascot

- Анимировать keeper.png через Sora (вращение 360°, 3 сек loop)
- Или CSS `rotateY` если Sora не даст нужного результата

---

## Notes

- Базовая функциональность use case уже реализована в HACKATHON-USECASES-UI-001
- Этот таск — только визуальный слой поверх
- Sora промпты для keeper уже готовы
