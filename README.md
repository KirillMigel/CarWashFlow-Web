# CarWashFlow Web

Отдельная React + TypeScript-реализация флоу мойки автомобиля. Исходный SwiftUI-проект остаётся в независимом репозитории [`CarWashFlow`](https://github.com/KirillMigel/CarWashFlow).

## Что внутри

- `web/` — адаптивное React-приложение для браузера и `WKWebView`.
- `ios/` — тонкая iOS 26-оболочка на SwiftUI с `WKWebView` и мостом для success-haptic.
- `scripts/sync-web-to-ios.sh` — собирает React и копирует результат в iOS bundle.

Интерактивная очистка сделана Canvas-маской: грязный слой стирается только под тряпкой, а переход к следующему состоянию срабатывает после очистки всего силуэта. Тряпка отрисовывается как деформируемая WebGL-сетка с адаптированной Verlet-физикой из [Holocloth](https://github.com/dmitrykurash/holocloth); голографический материал не используется. После завершения по машине один раз проходит shine, появляются звёздочки и остаётся мягкое пульсирующее свечение.

## Запуск web

```bash
cd web
pnpm install
pnpm dev
```

## Запуск iOS WebView

```bash
PNPM_COMMAND=pnpm ./scripts/sync-web-to-ios.sh
open ios/CarWashWebView.xcodeproj
```

В Xcode выберите iPhone с iOS 26 и запустите схему `CarWashWebView`.
