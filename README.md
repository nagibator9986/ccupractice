# CCU PRACTICUM

Цифровая система автоматического формирования трёхсторонних договоров профессиональной практики для колледжа КОУ.

Стек: **React + Vite + TailwindCSS** на фронте, **Flask + SQLAlchemy + SQLite** на бэкенде, интеграция с **NCALayer (kz.gov.pki.knca.basics)** для подписания договоров ЭЦП.

## Возможности

| ТЗ | Реализация |
| --- | --- |
| Реестр партнёров (БИН, директор, банк, мест, статус, срок) | `/partners` |
| Реестр студентов (ИИН, группа, специальность, период практики, руководители) | `/students` |
| Автоматическое формирование договора Word + PDF из шаблона | `/contracts/<id>` → «Сформировать договор» |
| Автонумерация `ПП-YYYY-NNN` | `services/numbering.py` |
| Электронный архив `Профессиональная практика/<год>/<партнёр>/Договоры` | `backend/archive/` |
| Поиск/фильтрация (организация, ФИО, группа, специальность, период, статус) | реализовано в фильтрах |
| Статусы договора (черновик → завершён) | 6 статусов согласно ТЗ |
| Загрузка скана (PDF/JPG/PNG) | `/contracts/<id>` |
| Роли пользователей: Администратор / Просмотр | JWT + role_required |
| Безопасность: логин/пароль, защита архива от Viewer, шифрованные пароли | bcrypt + JWT |
| Шаблон договора с переменными | docxtpl + страница «Настройки» |
| **ЭЦП через NCALayer (бонус)** | `/signatures` + `utils/ncalayer.js` |

## Быстрый старт (локально)

### 1) Бэкенд

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # опционально подправьте значения
python run.py         # http://127.0.0.1:5000
```

При первом запуске будут созданы:

- база `instance/ccu.db`
- администратор `admin@ccu.kz / admin123`
- наблюдатель `viewer@ccu.kz / viewer123`
- настройки колледжа из ТЗ
- шаблон договора `templates_docx/contract_template.docx`

### 2) Фронтенд

```bash
cd frontend
npm install
npm run dev           # http://127.0.0.1:5173 (proxy → бэкенд на :5000)
```

Открыть http://127.0.0.1:5173 и войти под `admin@ccu.kz / admin123`.

### 3) PDF-конвертация

DOCX генерируется всегда. Для автоматической конвертации в PDF на сервере должен быть установлен **LibreOffice** (команда `soffice` в PATH).

- macOS: `brew install --cask libreoffice`
- Ubuntu: `sudo apt install libreoffice`
- Windows: установите LibreOffice и добавьте `soffice.exe` в PATH

При отсутствии LibreOffice DOCX скачивается без проблем, PDF просто не будет создан (отображается подсказка в UI).

### 4) NCALayer (для подписания ЭЦП)

1. Установите NCALayer с https://pki.gov.kz/ncalayer/
2. Запустите приложение (иконка в трее)
3. На странице договора нажмите «Подписать как …» — браузер вызовет NCALayer через WebSocket `wss://127.0.0.1:13579`, пользователь выберет хранилище ключа (PKCS12, ID-карта, токен) и введёт пароль
4. Полученная CMS-подпись сохраняется в БД и привязывается к договору. Backend парсит сертификат подписанта и извлекает ФИО + ИИН/БИН.

После подписания всеми тремя сторонами (колледж, предприятие, обучающийся) статус автоматически становится «Подписан».

## Структура проекта

```
backend/
  app/
    api/           Flask blueprints (auth, partners, students, contracts, archive, settings, signatures)
    models/        SQLAlchemy модели
    services/      template_builder, document_generator, numbering, signature_service, bootstrap
    utils/         auth, files, serializers
  templates_docx/  Шаблон договора .docx
  archive/         Сгенерированные договоры (структурированы по году и партнёру)
  uploads/         Сканы подписанных договоров
  instance/ccu.db  SQLite
frontend/
  src/
    api/           axios клиент + endpoints
    components/    Layout, Modal, Field, PageHeader, StatusBadge
    context/       AuthContext
    pages/         Login, Dashboard, Partners, Students, Contracts, ContractDetail, Archive, Settings
    utils/         ncalayer.js (WebSocket к NCALayer), format.js
```

## Шаблон договора

Шаблон по умолчанию построен из исходного «Договора 3-х сторон» и поддерживает Jinja2-переменные через `docxtpl`. Пример полей:

```
{{ contract.number }}                      ПП-2026-001
{{ contract.date }}                        31.05.2026
{{ college.name_ru }}                      Колледж УО «КОУ»
{{ partner.organization_name }}            ТОО «Allur Auto Centre»
{{ partner.bin }}                          091240006074
{{ student.full_name }}                    Иванов Иван Иванович
{{ student.iin }}                          050101500000
{{ student.specialty }}                    Автомеханика
{{ student.practice_start }} → {{ student.practice_end }}
```

Загрузить собственный шаблон можно в разделе «Настройки шаблона». Названия переменных см. там же.

## Безопасность

- Bcrypt для хранения паролей пользователей
- JWT (HS256) c 12-часовым TTL
- CORS только для `/api/*`
- Role-based access: Viewer может только читать и скачивать, Administrator — всё
- ЭЦП хранится в исходном виде (CMS base64) вместе с сертификатом подписанта и хэшем SHA256 подписанного DOCX — это позволяет в любой момент проверить целостность документа и установить личность подписанта

## Развёртывание на Railway

В корне репозитория уже лежат `Dockerfile`, `.dockerignore` и `railway.json`.
Railway сам подберёт Dockerfile-сборку.

### Шаги

1. **Создайте проект** на [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** (или `railway up` через CLI). Корнем сборки укажите эту директорию (`ccu-practicum/`).
2. **Добавьте плагин PostgreSQL** (`+ New → Database → PostgreSQL`). Railway сам создаст переменную `DATABASE_URL` — Flask приведёт её к формату `postgresql://` автоматически.
3. **Установите переменные окружения** для сервиса:

   | Переменная | Назначение |
   | --- | --- |
   | `SECRET_KEY` | случайная строка ≥ 32 символов |
   | `JWT_SECRET_KEY` | случайная строка ≥ 32 символов |
   | `ADMIN_EMAIL` | логин администратора (по умолчанию `admin@ccu.kz`) |
   | `ADMIN_PASSWORD` | пароль администратора (смените его!) |
   | `VIEWER_PASSWORD` | пароль наблюдателя |
   | `CORS_ORIGINS` | `*` либо список разрешённых origin через запятую |
   | `WEB_CONCURRENCY` | (опц.) число воркеров gunicorn, по умолчанию `2` |
   | `WEB_THREADS` | (опц.) число потоков, по умолчанию `4` |
   | `JWT_TTL_HOURS` | (опц.) TTL access-токена, по умолчанию `12` |

   Переменные `PORT` и `DATABASE_URL` Railway проставляет сам.

4. **Подключите Volume** (`+ Add → Volume`) и смонтируйте его к
   `/app/backend/archive` (сгенерированные договоры) и/или
   `/app/backend/uploads` (сканы). Без volume эти файлы будут теряться при
   каждом redeploy. Базу данных хранит Postgres-плагин — её volume трогать
   не нужно.

5. **Сгенерируйте публичный домен** во вкладке *Settings → Networking →
   Generate Domain*. Health-чек настроен на `/healthz`.

6. После первого деплоя залогиньтесь под `ADMIN_EMAIL / ADMIN_PASSWORD`.

### Что делает Docker-образ

- стадия `frontend-build` — `node:20-alpine`, выполняет `npm ci && npm run build`;
- стадия `runtime` — `python:3.12-slim`, ставит `LibreOffice` (для DOCX → PDF), русскую локаль и системные шрифты, копирует backend и собранный `frontend/dist`;
- `gunicorn` слушает `0.0.0.0:$PORT`, Flask отдаёт SPA из `/app/frontend/dist`, а API — на `/api/*`.

### Отдельный фронтенд (опционально)

Если хочется хостить SPA на стороннем CDN/Vercel, соберите фронтенд с
переменной `VITE_API_BASE_URL=https://<railway-домен>` и не копируйте
`dist/` в backend-образ. Backend останется чисто API-сервером — CORS
управляется через `CORS_ORIGINS`.

### Локальная проверка Docker-сборки

```bash
docker build -t ccu-practicum .
docker run --rm -p 8000:8000 \
  -e SECRET_KEY=dev -e JWT_SECRET_KEY=dev \
  -e ADMIN_EMAIL=admin@ccu.kz -e ADMIN_PASSWORD=admin123 \
  ccu-practicum
# открыть http://127.0.0.1:8000
```

## Лицензия

Внутренняя разработка для колледжа КОУ. Использует open-source библиотеки под соответствующими лицензиями (Flask, React, Tailwind, docxtpl, cryptography, asn1crypto и др.).
