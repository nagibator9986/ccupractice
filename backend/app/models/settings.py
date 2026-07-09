from datetime import datetime
from ..utils.time import utc_now
from ..extensions import db


class CollegeSettings(db.Model):
    __tablename__ = "college_settings"

    id = db.Column(db.Integer, primary_key=True)
    name_ru = db.Column(db.String(300), default='Колледж УО «КОУ»')
    name_kz = db.Column(db.String(300), default='«КҚУ» Колледжі білім беру мекемесі')
    director_full_name = db.Column(db.String(200), default="Ануаш Ж.Д.")
    director_basis = db.Column(db.String(200), default="Приказа")
    # Personal IIN on the director's ЭЦП certificate. Optional — populate it
    # only if the director signs with a personal certificate (the common case
    # in KZ colleges); the college-sign endpoint then accepts BIN OR this IIN
    # as a valid signer identity, eliminating the spurious "mismatch" warning
    # on every legitimate director sign.
    director_iin = db.Column(db.String(20), default="")
    address = db.Column(db.String(300), default="г. Алматы, проспект Сейфуллина, 521")
    bin = db.Column(db.String(20), default="030640000531")
    iik = db.Column(db.String(40), default="KZ9584901KZ014467972")
    bank_name = db.Column(db.String(200), default="АФ АО Нурбанк")
    bank_address = db.Column(db.String(200), default="г. Алматы, ул. Желтоксан, 173")
    bank_bik = db.Column(db.String(40), default="NURSKZKX")
    email = db.Column(db.String(160), default="college.kou@gmail.com")
    phone = db.Column(db.String(60), default="8 (727) 279-37-77")
    city = db.Column(db.String(80), default="Алматы")
    template_path = db.Column(db.String(500), default="contract_template.docx")
    contract_prefix = db.Column(db.String(10), default="ПП")

    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name_ru": self.name_ru,
            "name_kz": self.name_kz,
            "director_full_name": self.director_full_name,
            "director_basis": self.director_basis,
            "director_iin": self.director_iin or "",
            "address": self.address,
            "bin": self.bin,
            "iik": self.iik,
            "bank_name": self.bank_name,
            "bank_address": self.bank_address,
            "bank_bik": self.bank_bik,
            "email": self.email,
            "phone": self.phone,
            "city": self.city,
            "template_path": self.template_path,
            "contract_prefix": self.contract_prefix,
        }


class ContractCounter(db.Model):
    __tablename__ = "contract_counters"

    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, unique=True, nullable=False)
    last_number = db.Column(db.Integer, default=0, nullable=False)
