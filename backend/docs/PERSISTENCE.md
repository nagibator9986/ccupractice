# Persistence — STOP & read before deploying

## Симптом

После каждого `git push origin main` Railway / Render / etc. собирает
новый контейнер. **Если данные сохраняются внутри контейнера, они исчезают
на каждом редеплое**: все договоры, партнёры, студенты, подписи,
сгенерированные DOCX/PDF — обнуляются.

## Как платформа подсказывает

На старте приложение запускает `check_persistence(...)` и:

1. печатает огромный баннер «⚠⚠⚠ PERSISTENCE WARNING» в **stderr** —
   виден в Railway → Deployments → View logs;
2. помечает `GET /api/health` и `GET /healthz` полем `persistent: false`
   плюс списком `persistence_hints`. Любой внешний мониторинг увидит сразу.

Пример «плохого» ответа `/healthz`:

```json
{
  "status": "ok",
  "persistent": false,
  "persistence_warning": "data is on ephemeral storage — will be wiped on next redeploy",
  "persistence_hints": [
    "ALL data created via the SPA will be lost on the next redeploy.",
    "FIX (DB): add the PostgreSQL plug-in in the Railway dashboard...",
    "FIX (files): mount a Railway Volume to each of: /app/backend/archive, /app/backend/uploads..."
  ]
}
```

## Как починить

### Вариант A — рекомендуемый: Postgres plug-in + Volumes для файлов

1. **Railway → + New → Database → PostgreSQL**
   Railway автоматически создаёт переменную `DATABASE_URL` вида
   `postgres://user:pass@host:5432/dbname`. Код в [`app/__init__.py`](../app/__init__.py)
   нормализует её в `postgresql://`, миграции Alembic накатываются
   автоматически на старте — никаких правок не нужно.

2. **Railway → + New → Volume** (повторите дважды):
   * mount path `/app/backend/archive` — сгенерированные DOCX/PDF
   * mount path `/app/backend/uploads` — загруженные сканы

3. Redeploy. Проверьте: `curl https://<your-domain>/healthz` →
   `{"status": "ok", "persistent": true}`.

### Вариант B — быстрый: всё на SQLite + три Volumes

Если не хочется Postgres — три Volume вместо одного.

1. **Volume** на `/app/backend/instance` — SQLite-файл `ccu.db` + сгенерированные
   секреты `.secret_key` / `.jwt_secret_key`
2. **Volume** на `/app/backend/archive`
3. **Volume** на `/app/backend/uploads`

> Производительность SQLite под нагрузкой ниже Postgres, миграции через
> `batch_alter_table` идут медленнее. На небольшом колледже (десятки
> договоров в день) проблем нет.

## Что произойдёт, если ничего не сделать

* **Контейнер запускается** → пустые таблицы, `flask db upgrade` создаёт
  схему с нуля → seed-скрипт создаёт `admin@ccu.kz` со случайным паролем
  (он печатается в логи один раз).
* **Все договоры, партнёры, студенты, подписи, файлы** — стёрты.
* Платформа продолжает работать, но кажется «сломанной» — это и есть
  симптом, который описан в задаче.

## Локальная разработка

Heuristic в `app/utils/persistence.py` сравнивает `st_dev` каталога с
`st_dev` корня контейнера (`/app` или `/workspace`). Вне Docker ни одного
из этих путей нет — функция возвращает persistent=True, и никакого
шумного warning'а локально не появится.

## Где смотреть код

* Детектор: [`app/utils/persistence.py`](../app/utils/persistence.py)
* Хук на старте + `/healthz` / `/api/health`: [`app/__init__.py`](../app/__init__.py)
