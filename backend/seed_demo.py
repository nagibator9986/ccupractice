"""Populate the platform with realistic demo data for end-to-end testing.

Usage:
    cd backend && . .venv/bin/activate && python seed_demo.py

The script is idempotent: running it again wipes prior demo records and
re-creates them. It does NOT touch the admin/viewer users.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path

from app import create_app
from app.extensions import db
from app.models import (
    Contract,
    ContractStatus,
    Partner,
    Student,
    SigningRequest,
    Signature,
)
from app.services.document_generator import generate_contract_files
from app.services.numbering import next_contract_number
from app.utils.time import utc_now


# ────────────────────────────────────────────────────────────────
# Demo data
# ────────────────────────────────────────────────────────────────

PARTNERS = [
    {
        "organization_name": "ТОО «Allur Auto Centre»",
        "bin": "091240006074",
        "legal_address": "Республика Казахстан, г. Алматы, пр. Суюнбая, дом № 159 А",
        "actual_address": "г. Алматы, пр. Суюнбая, дом № 159 А",
        "director_full_name": "Кошкарев В. В.",
        "director_position": "Генеральный директор",
        "director_basis": "Устава",
        "contact_person": "Алиева Г. М.",
        "phone": "+7 (727) 313-13-13",
        "email": "hr@allur-auto.kz",
        "specialty": "Автомеханика, техобслуживание автотранспорта",
        "seats_count": 8,
        "contract_status": "active",
        "contract_valid_until": "2027-12-31",
        "bank_name": "АО «Евразийский Банк»",
        "bank_bik": "EURIKZKA",
        "bank_iik": "KZ8894806KZT22034088",
        "notes": "Стратегический партнёр по автомобильным специальностям.",
    },
    {
        "organization_name": "АО «Каспи Банк»",
        "bin": "971240001315",
        "legal_address": "г. Алматы, пр. Назарбаева, 154А",
        "actual_address": "г. Алматы, пр. Назарбаева, 154А",
        "director_full_name": "Ким М. С.",
        "director_position": "Председатель Правления",
        "director_basis": "Устава",
        "contact_person": "Сулейменов Е. К.",
        "phone": "+7 (727) 250-99-99",
        "email": "career@kaspi.kz",
        "specialty": "Финансы, банковское дело, IT",
        "seats_count": 12,
        "contract_status": "active",
        "contract_valid_until": "2027-06-30",
        "bank_name": "АО «Kaspi Bank»",
        "bank_bik": "CASPKZKA",
        "bank_iik": "KZ12345678901234567890",
        "notes": "Программа стажировок для финансово-экономических групп.",
    },
    {
        "organization_name": "ТОО «BI Group»",
        "bin": "010540000532",
        "legal_address": "г. Астана, пр. Туран, 18",
        "actual_address": "г. Алматы, ул. Розыбакиева, 247",
        "director_full_name": "Айдарбеков Р. Т.",
        "director_position": "Генеральный директор филиала",
        "director_basis": "Доверенности № 12 от 15.01.2026",
        "contact_person": "Жумабаева А. Б.",
        "phone": "+7 (727) 311-11-11",
        "email": "hr-almaty@bi.group",
        "specialty": "Строительство, инженерные сети, архитектура",
        "seats_count": 6,
        "contract_status": "active",
        "contract_valid_until": "2026-12-31",
        "bank_name": "АО «Halyk Bank»",
        "bank_bik": "HSBKKZKX",
        "bank_iik": "KZ98765432109876543210",
        "notes": "Производственная практика строителям и архитекторам.",
    },
    {
        "organization_name": "ТОО «Chocofamily Holding»",
        "bin": "120540019874",
        "legal_address": "г. Алматы, ул. Сатпаева, 90/1",
        "actual_address": "г. Алматы, БЦ «Caspian Offices», 5 этаж",
        "director_full_name": "Турлыбаев Р. Е.",
        "director_position": "CEO",
        "director_basis": "Устава",
        "contact_person": "Назарбаева Д. К.",
        "phone": "+7 (708) 555-66-77",
        "email": "people@chocofamily.kz",
        "specialty": "IT, маркетинг, веб-разработка",
        "seats_count": 5,
        "contract_status": "active",
        "contract_valid_until": "2027-03-31",
        "bank_name": "АО «Forte Bank»",
        "bank_bik": "FFINKZA1",
        "bank_iik": "KZ44556677889900112233",
        "notes": "Практика для IT-специальностей.",
    },
    {
        "organization_name": "АО «КазМунайГаз»",
        "bin": "020440000186",
        "legal_address": "г. Астана, пр. Кабанбай батыра, 19",
        "actual_address": "г. Атырау, пр. Сатпаева, 3",
        "director_full_name": "Сатыбалды М. Б.",
        "director_position": "Заместитель Председателя Правления",
        "director_basis": "Устава",
        "contact_person": "Оразалин С. Ж.",
        "phone": "+7 (7172) 78-99-99",
        "email": "internship@kmg.kz",
        "specialty": "Нефтегазовое дело, химия, экология",
        "seats_count": 4,
        "contract_status": "active",
        "contract_valid_until": "2026-09-30",
        "bank_name": "АО «Halyk Bank»",
        "bank_bik": "HSBKKZKX",
        "bank_iik": "KZ22113344556677889900",
        "notes": "Преддипломная практика по нефтегазовым специальностям.",
    },
    {
        "organization_name": "ТОО «Magnum Cash & Carry»",
        "bin": "070840009056",
        "legal_address": "г. Алматы, ул. Гагарина, 233/2",
        "actual_address": "г. Алматы, ул. Гагарина, 233/2",
        "director_full_name": "Аралбаев Б. К.",
        "director_position": "Региональный директор",
        "director_basis": "Доверенности № 4-7 от 20.04.2026",
        "contact_person": "Бекенов Д. С.",
        "phone": "+7 (727) 244-44-44",
        "email": "practice@magnum.kz",
        "specialty": "Логистика, торговое дело, менеджмент",
        "seats_count": 10,
        "contract_status": "active",
        "contract_valid_until": "2027-02-28",
        "bank_name": "АО «Jusan Bank»",
        "bank_bik": "TSESKZKA",
        "bank_iik": "KZ11223344556677889911",
        "notes": "Практика для менеджеров и логистов.",
    },
]


STUDENTS = [
    # Группа АТ-21 (Автомеханика) — партнёр 0 (Allur)
    {"full_name": "Иванов Иван Иванович", "iin": "050514500123", "group_name": "АТ-21",
     "specialty": "Автомеханика", "specialty_code": "07140100", "course": 3,
     "education_program": "Техническое обслуживание автотранспорта",
     "practice_start": "2026-06-01", "practice_end": "2026-07-31",
     "college_supervisor": "Петров Пётр Петрович", "partner_idx": 0,
     "partner_supervisor": "Кошкарев В. В.",
     "birth_date": "2005-05-14", "id_card_number": "041234567",
     "id_card_issued_by": "МВД РК 14.05.2021", "home_address": "г. Алматы, ул. Абая, 100, кв. 12",
     "phone": "+7 707 100 1001", "enrollment_year": 2024,
     "legal_rep_full_name": "Иванова Мария Сергеевна", "legal_rep_iin": "800101400123", "legal_rep_phone": "+7 707 200 2002"},
    {"full_name": "Сидоров Алексей Викторович", "iin": "050822500456", "group_name": "АТ-21",
     "specialty": "Автомеханика", "specialty_code": "07140100", "course": 3,
     "education_program": "Техническое обслуживание автотранспорта",
     "practice_start": "2026-06-01", "practice_end": "2026-07-31",
     "college_supervisor": "Петров Пётр Петрович", "partner_idx": 0,
     "partner_supervisor": "Кошкарев В. В.",
     "birth_date": "2005-08-22", "id_card_number": "042345678",
     "id_card_issued_by": "МВД РК 22.08.2021", "home_address": "г. Алматы, мкр. Самал-2, 33, кв. 7",
     "phone": "+7 707 100 1002", "enrollment_year": 2024},
    {"full_name": "Жумагалиев Нурлан Маратович", "iin": "051203500789", "group_name": "АТ-21",
     "specialty": "Автомеханика", "specialty_code": "07140100", "course": 3,
     "education_program": "Техническое обслуживание автотранспорта",
     "practice_start": "2026-06-01", "practice_end": "2026-07-31",
     "college_supervisor": "Петров Пётр Петрович", "partner_idx": 0,
     "birth_date": "2005-12-03", "id_card_number": "043456789",
     "home_address": "г. Алматы, ул. Жибек Жолы, 50", "phone": "+7 707 100 1003",
     "enrollment_year": 2024},

    # Группа ФБ-22 (Финансы) — партнёр 1 (Kaspi)
    {"full_name": "Темирова Айгуль Ержановна", "iin": "060417400111", "group_name": "ФБ-22",
     "specialty": "Финансы", "specialty_code": "04140100", "course": 2,
     "education_program": "Банковское и страховое дело",
     "practice_start": "2026-05-15", "practice_end": "2026-07-15",
     "college_supervisor": "Касенова А. К.", "partner_idx": 1,
     "partner_supervisor": "Сулейменов Е. К.",
     "birth_date": "2006-04-17", "id_card_number": "044567890",
     "home_address": "г. Алматы, ул. Толе би, 15", "phone": "+7 707 200 2003",
     "enrollment_year": 2025},
    {"full_name": "Ахметов Динмухамед Серикулы", "iin": "061122500234", "group_name": "ФБ-22",
     "specialty": "Финансы", "specialty_code": "04140100", "course": 2,
     "education_program": "Банковское и страховое дело",
     "practice_start": "2026-05-15", "practice_end": "2026-07-15",
     "college_supervisor": "Касенова А. К.", "partner_idx": 1,
     "birth_date": "2006-11-22", "id_card_number": "045678901",
     "home_address": "г. Алматы, ул. Достык, 200", "phone": "+7 707 200 2004",
     "enrollment_year": 2025},

    # Группа СТ-21 (Строительство) — партнёр 2 (BI Group)
    {"full_name": "Бекжанов Арман Бахытжанович", "iin": "050201500567", "group_name": "СТ-21",
     "specialty": "Строительство и эксплуатация зданий", "specialty_code": "07320100",
     "course": 3, "education_program": "Промышленное и гражданское строительство",
     "practice_start": "2026-04-01", "practice_end": "2026-06-30",
     "college_supervisor": "Айдаров Б. М.", "partner_idx": 2,
     "partner_supervisor": "Айдарбеков Р. Т.",
     "birth_date": "2005-02-01", "id_card_number": "046789012",
     "home_address": "г. Алматы, мкр. Орбита-3, 17", "phone": "+7 707 300 3001",
     "enrollment_year": 2024},
    {"full_name": "Калиев Жанибек Талгатович", "iin": "050930500678", "group_name": "СТ-21",
     "specialty": "Строительство и эксплуатация зданий", "specialty_code": "07320100",
     "course": 3, "education_program": "Промышленное и гражданское строительство",
     "practice_start": "2026-04-01", "practice_end": "2026-06-30",
     "college_supervisor": "Айдаров Б. М.", "partner_idx": 2,
     "birth_date": "2005-09-30", "id_card_number": "047890123",
     "home_address": "г. Алматы, ул. Тимирязева, 42", "phone": "+7 707 300 3002",
     "enrollment_year": 2024},

    # Группа ИТ-23 (IT) — партнёр 3 (Chocofamily)
    {"full_name": "Нурланов Тимур Алмазович", "iin": "070605500890", "group_name": "ИТ-23",
     "specialty": "Информационные технологии", "specialty_code": "06130100",
     "course": 1, "education_program": "Программирование и веб-разработка",
     "practice_start": "2026-07-01", "practice_end": "2026-08-31",
     "college_supervisor": "Молдабекова Г. Ж.", "partner_idx": 3,
     "partner_supervisor": "Назарбаева Д. К.",
     "birth_date": "2007-06-05", "id_card_number": "048901234",
     "home_address": "г. Алматы, ул. Манаса, 28", "phone": "+7 707 400 4001",
     "enrollment_year": 2026, "form_of_study": "очная"},
    {"full_name": "Сапарбекова Жанель Жасулановна", "iin": "070812400901", "group_name": "ИТ-23",
     "specialty": "Информационные технологии", "specialty_code": "06130100",
     "course": 1, "education_program": "Программирование и веб-разработка",
     "practice_start": "2026-07-01", "practice_end": "2026-08-31",
     "college_supervisor": "Молдабекова Г. Ж.", "partner_idx": 3,
     "birth_date": "2007-08-12", "id_card_number": "049012345",
     "home_address": "г. Алматы, ул. Кабанбай батыра, 53", "phone": "+7 707 400 4002",
     "enrollment_year": 2026},

    # Группа НГ-22 (Нефтегаз) — партнёр 4 (KMG)
    {"full_name": "Мухамедов Ержан Кайратович", "iin": "060101500012", "group_name": "НГ-22",
     "specialty": "Нефтегазовое дело", "specialty_code": "07210100",
     "course": 2, "education_program": "Разработка нефтегазовых месторождений",
     "practice_start": "2026-06-15", "practice_end": "2026-08-15",
     "college_supervisor": "Тулегенов Б. К.", "partner_idx": 4,
     "partner_supervisor": "Оразалин С. Ж.",
     "birth_date": "2006-01-01", "id_card_number": "050123456",
     "home_address": "г. Атырау, ул. Айтиева, 12", "phone": "+7 707 500 5001",
     "enrollment_year": 2025},

    # Группа МН-22 (Менеджмент) — партнёр 5 (Magnum)
    {"full_name": "Аманжолова Дана Бахытжановна", "iin": "060507400123", "group_name": "МН-22",
     "specialty": "Менеджмент", "specialty_code": "04140200",
     "course": 2, "education_program": "Торговый менеджмент",
     "practice_start": "2026-05-01", "practice_end": "2026-06-30",
     "college_supervisor": "Аубакирова Р. С.", "partner_idx": 5,
     "partner_supervisor": "Бекенов Д. С.",
     "birth_date": "2006-05-07", "id_card_number": "051234567",
     "home_address": "г. Алматы, мкр. Аксай-4, 67", "phone": "+7 707 600 6001",
     "enrollment_year": 2025},
    {"full_name": "Кулебаев Санжар Маратович", "iin": "060728500234", "group_name": "МН-22",
     "specialty": "Менеджмент", "specialty_code": "04140200",
     "course": 2, "education_program": "Торговый менеджмент",
     "practice_start": "2026-05-01", "practice_end": "2026-06-30",
     "college_supervisor": "Аубакирова Р. С.", "partner_idx": 5,
     "birth_date": "2006-07-28", "id_card_number": "052345678",
     "home_address": "г. Алматы, ул. Жандосова, 100", "phone": "+7 707 600 6002",
     "enrollment_year": 2025},
]


# Контракты: (student_idx, status_target, contract_date, create_files, with_signing_requests)
CONTRACTS = [
    # 0 — Allur / Иванов: завершён, скан загружен
    {"student_idx": 0, "target_status": ContractStatus.COMPLETED, "date_offset": -30, "generate": True, "send_invites": True, "scan_uploaded": True},
    # 1 — Allur / Сидоров: подписан всеми сторонами
    {"student_idx": 1, "target_status": ContractStatus.SIGNED, "date_offset": -15, "generate": True, "send_invites": True, "fake_sign_all": True},
    # 2 — Allur / Жумагалиев: ссылки отправлены, частично просмотрено
    {"student_idx": 2, "target_status": ContractStatus.SENT, "date_offset": -10, "generate": True, "send_invites": True},
    # 3 — Kaspi / Темирова: подписан
    {"student_idx": 3, "target_status": ContractStatus.SIGNED, "date_offset": -8, "generate": True, "send_invites": True, "fake_sign_all": True},
    # 4 — Kaspi / Ахметов: только сформирован
    {"student_idx": 4, "target_status": ContractStatus.GENERATED, "date_offset": -3, "generate": True},
    # 5 — BI Group / Бекжанов: отправлен партнёру
    {"student_idx": 5, "target_status": ContractStatus.SENT, "date_offset": -7, "generate": True, "send_invites": True},
    # 6 — BI Group / Калиев: подписан партнёром и колледжем, ожидает студента
    {"student_idx": 6, "target_status": ContractStatus.SENT, "date_offset": -5, "generate": True, "send_invites": True, "fake_sign_roles": ["college", "partner"]},
    # 7 — Chocofamily / Нурланов: сформирован, ожидает отправки
    {"student_idx": 7, "target_status": ContractStatus.GENERATED, "date_offset": -2, "generate": True},
    # 8 — Chocofamily / Сапарбекова: черновик
    {"student_idx": 8, "target_status": ContractStatus.DRAFT, "date_offset": -1, "generate": False},
    # 9 — KMG / Мухамедов: подписан, скан загружен
    {"student_idx": 9, "target_status": ContractStatus.SCAN_UPLOADED, "date_offset": -20, "generate": True, "send_invites": True, "fake_sign_all": True, "scan_uploaded": True},
    # 10 — Magnum / Аманжолова: подписан
    {"student_idx": 10, "target_status": ContractStatus.SIGNED, "date_offset": -12, "generate": True, "send_invites": True, "fake_sign_all": True},
    # 11 — Magnum / Кулебаев: черновик
    {"student_idx": 11, "target_status": ContractStatus.DRAFT, "date_offset": 0, "generate": False},
]


# ────────────────────────────────────────────────────────────────
# Seeding logic
# ────────────────────────────────────────────────────────────────

def parse_date(s):
    if not s:
        return None
    return datetime.strptime(s, "%Y-%m-%d").date()


def wipe_demo_records():
    """Drop demo-grade rows (everything except users/college_settings/counter)."""
    Signature.query.delete()
    SigningRequest.query.delete()
    Contract.query.delete()
    Student.query.delete()
    Partner.query.delete()
    from app.models import ContractCounter
    ContractCounter.query.delete()
    db.session.commit()


def make_fake_cms_for(payload_sha256: str) -> str:
    """Produce a placeholder base64 'CMS' for visualizing signed contracts.

    Real ЭЦП is produced via NCALayer at runtime — this is purely a stand-in
    so the UI can demonstrate the signed state. The placeholder is clearly
    marked and won't pass cryptographic verification.
    """
    import base64
    payload = f"DEMO-SIGNATURE-PLACEHOLDER-{payload_sha256[:16]}".encode()
    return base64.b64encode(payload).decode()


def attach_demo_signature(contract: Contract, role: str, signer_meta: dict):
    """Insert a Signature + matching SigningRequest in 'signed' state."""
    payload_path = Path(contract.docx_path)
    if contract.docx_path:
        full_path = Path(__import__("flask").current_app.config["ARCHIVE_FOLDER"]) / contract.docx_path
        if full_path.exists():
            import hashlib
            sha = hashlib.sha256(full_path.read_bytes()).hexdigest()
        else:
            sha = "demo" + "0" * 60
    else:
        sha = "demo" + "0" * 60

    sig = Signature(
        contract_id=contract.id,
        signer_role=role,
        signer_full_name=signer_meta["name"],
        signer_iin_or_bin=signer_meta["iin_or_bin"],
        signer_serial=signer_meta["serial"],
        signer_certificate_pem="-----BEGIN CERTIFICATE-----\nDEMO PLACEHOLDER — replace via real ЭЦП\n-----END CERTIFICATE-----",
        cms_signature=make_fake_cms_for(sha),
        signed_payload_sha256=sha,
        created_at=utc_now() - timedelta(hours=2),
    )
    db.session.add(sig)
    db.session.flush()
    return sig


def create_signing_requests(contract: Contract, roles: list[str], status: str = "pending") -> dict:
    """Create signing requests for given roles, return {role: SigningRequest}."""
    defaults = {
        "college": {"name": "Ануаш Ж. Д.", "email": "college.kou@gmail.com", "iin_or_bin": "030640000531"},
        "partner": {
            "name": contract.partner.director_full_name or contract.partner.organization_name,
            "email": contract.partner.email or "",
            "iin_or_bin": contract.partner.bin or "",
        },
        "student": {
            "name": contract.student.full_name,
            "email": "",
            "iin_or_bin": contract.student.iin or "",
        },
    }
    out = {}
    for role in roles:
        sr = SigningRequest.create_for(contract.id, role, defaults[role])
        sr.status = status
        if status == "viewed":
            sr.viewed_at = utc_now() - timedelta(hours=1)
        db.session.add(sr)
        out[role] = sr
    db.session.flush()
    return out


def main():
    app = create_app()
    with app.app_context():
        print("→ Wiping prior demo data…")
        wipe_demo_records()

        # Partners
        partners: list[Partner] = []
        print(f"→ Creating {len(PARTNERS)} partners…")
        for p in PARTNERS:
            partner = Partner(
                organization_name=p["organization_name"],
                bin=p["bin"],
                legal_address=p["legal_address"],
                actual_address=p["actual_address"],
                director_full_name=p["director_full_name"],
                director_position=p["director_position"],
                director_basis=p["director_basis"],
                contact_person=p["contact_person"],
                phone=p["phone"],
                email=p["email"],
                specialty=p["specialty"],
                seats_count=p["seats_count"],
                contract_status=p["contract_status"],
                contract_valid_until=parse_date(p["contract_valid_until"]),
                bank_name=p["bank_name"],
                bank_bik=p["bank_bik"],
                bank_iik=p["bank_iik"],
                notes=p["notes"],
            )
            db.session.add(partner)
            partners.append(partner)
        db.session.commit()

        # Students
        students: list[Student] = []
        print(f"→ Creating {len(STUDENTS)} students…")
        for s in STUDENTS:
            partner = partners[s["partner_idx"]]
            student = Student(
                full_name=s["full_name"],
                iin=s["iin"],
                group_name=s["group_name"],
                specialty=s["specialty"],
                specialty_code=s.get("specialty_code"),
                course=s["course"],
                education_program=s.get("education_program"),
                enrollment_year=s.get("enrollment_year"),
                form_of_study=s.get("form_of_study", "очная"),
                practice_type="профессиональной",
                practice_start=parse_date(s["practice_start"]),
                practice_end=parse_date(s["practice_end"]),
                college_supervisor=s["college_supervisor"],
                partner_supervisor=s.get("partner_supervisor"),
                partner_id=partner.id,
                birth_date=parse_date(s.get("birth_date")),
                id_card_number=s.get("id_card_number"),
                id_card_issued_by=s.get("id_card_issued_by"),
                home_address=s.get("home_address"),
                phone=s.get("phone"),
                legal_rep_full_name=s.get("legal_rep_full_name"),
                legal_rep_iin=s.get("legal_rep_iin"),
                legal_rep_phone=s.get("legal_rep_phone"),
            )
            db.session.add(student)
            students.append(student)
        db.session.commit()

        # Contracts
        print(f"→ Creating {len(CONTRACTS)} contracts…")
        today = date.today()
        for cfg in CONTRACTS:
            student = students[cfg["student_idx"]]
            cdate = today + timedelta(days=cfg["date_offset"])
            number, year, _ = next_contract_number(cdate.year)
            contract = Contract(
                number=number,
                year=year,
                contract_date=cdate,
                partner_id=student.partner_id,
                student_id=student.id,
                status=ContractStatus.DRAFT,
            )
            db.session.add(contract)
            db.session.flush()

            # Generate files where required
            if cfg.get("generate"):
                generate_contract_files(contract)
                contract.status = ContractStatus.GENERATED

            # Create signing requests
            if cfg.get("send_invites"):
                roles = ["college", "partner", "student"]
                # mark first as viewed for visual variety
                requests = create_signing_requests(contract, roles, status="pending")
                contract.status = ContractStatus.SENT
                # If targeting "sent" mark partner as viewed
                if cfg["target_status"] == ContractStatus.SENT:
                    requests["partner"].status = "viewed"
                    requests["partner"].viewed_at = utc_now() - timedelta(hours=3)

            # Fake signatures (placeholder for demo visualization)
            sign_roles = cfg.get("fake_sign_roles") or (["college", "partner", "student"] if cfg.get("fake_sign_all") else [])
            if sign_roles:
                # Auto-create missing signing requests
                existing_roles = {r.signer_role: r for r in SigningRequest.query.filter_by(contract_id=contract.id).all()}
                for role in sign_roles:
                    if role not in existing_roles:
                        rs = create_signing_requests(contract, [role])
                        existing_roles[role] = rs[role]

                signers = {
                    "college": {"name": "Ануаш Ж. Д.", "iin_or_bin": "030640000531", "serial": "01ABCDEF1234567890"},
                    "partner": {"name": contract.partner.director_full_name, "iin_or_bin": contract.partner.bin, "serial": "02FEDCBA0987654321"},
                    "student": {"name": contract.student.full_name, "iin_or_bin": contract.student.iin, "serial": "03ABC1234DEF5678"},
                }
                for role in sign_roles:
                    sig = attach_demo_signature(contract, role, signers[role])
                    sr = existing_roles[role]
                    sr.status = "signed"
                    sr.signed_at = utc_now() - timedelta(hours=2)
                    sr.signature_id = sig.id

                signed_roles = {s.signer_role for s in contract.signatures}
                if {"college", "partner", "student"}.issubset(signed_roles):
                    contract.status = ContractStatus.SIGNED

            # Apply target status if higher
            if cfg["target_status"] == ContractStatus.COMPLETED:
                contract.status = ContractStatus.COMPLETED
            elif cfg["target_status"] == ContractStatus.SCAN_UPLOADED:
                contract.status = ContractStatus.SCAN_UPLOADED

            if cfg.get("scan_uploaded"):
                # Create a placeholder scan file
                stamp = utc_now().strftime("%Y%m%d_%H%M%S")
                upload_dir = Path(app.config["UPLOAD_FOLDER"])
                upload_dir.mkdir(parents=True, exist_ok=True)
                scan_name = f"scan_{contract.number}_{stamp}.pdf"
                (upload_dir / scan_name).write_bytes(b"%PDF-1.4\n%demo placeholder scan\n")
                contract.signed_scan_path = scan_name

        db.session.commit()

        # Summary
        print("\n✅ Demo data ready:")
        print(f"   Partners:        {Partner.query.count()}")
        print(f"   Students:        {Student.query.count()}")
        print(f"   Contracts:       {Contract.query.count()}")
        print(f"   Signing reqs:    {SigningRequest.query.count()}")
        print(f"   Signatures:      {Signature.query.count()}")
        print()
        print("By status:")
        for status in ContractStatus.ALL:
            cnt = Contract.query.filter_by(status=status).count()
            if cnt:
                print(f"   {ContractStatus.LABELS[status]:30s} {cnt}")
        print("\nЛогин: admin@ccu.kz / admin123 → http://127.0.0.1:5173/")


if __name__ == "__main__":
    main()
