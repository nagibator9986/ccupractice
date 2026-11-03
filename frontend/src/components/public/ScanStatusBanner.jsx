import { CircleCheck, CircleX, Printer, TriangleAlert } from "lucide-react";
import { formatDate, formatDateTime } from "../../utils/format.js";
import StatusBanner from "./StatusBanner.jsx";
import { utcIso } from "./scanUtils.js";

/**
 * The status card on top of a «signing on paper» link (the signed state is `SignedConfirmation`).
 * Says what the signer has to do next and who acts after that.
 */
export default function ScanStatusBanner({ docReady, review, scan, expiresAt, className }) {
  if (!docReady) {
    return (
      <StatusBanner tone="amber" icon={TriangleAlert} title="Договор ещё не готов к подписанию" className={className}>
        Колледж ещё не сформировал файл договора. Скачать и подписать его пока нельзя — обратитесь в колледж, приславший ссылку.
      </StatusBanner>
    );
  }
  if (review === "pending") {
    return (
      <StatusBanner tone="emerald" icon={CircleCheck} title="Скан отправлен — ждём проверку колледжа" className={className}>
        {scan?.uploaded_at ? <>Вы отправили скан {formatDateTime(utcIso(scan.uploaded_at))}. </> : null}
        Пока колледж не принял скан, подпись не засчитывается. Результат появится на этой странице.
      </StatusBanner>
    );
  }
  if (review === "rejected") {
    return (
      <StatusBanner tone="red" icon={CircleX} title="Скан не принят — нужен новый" className={className} role="alert">
        Колледж вернул ваш скан. Причина указана в блоке «Подписание на бумаге». Исправьте и загрузите скан заново.
      </StatusBanner>
    );
  }
  return (
    <StatusBanner
      tone="coral"
      icon={Printer}
      title="Договор нужно подписать на бумаге"
      className={className}
      actions={
        <a className="link text-sm font-medium lg:hidden" href="#sign">
          Перейти к шагам
        </a>
      }
    >
      Скачайте договор, распечатайте, подпишите от руки и загрузите фото или скан — всё по шагам ниже, это займёт несколько минут.
      {expiresAt ? <> Ссылка действует до {formatDate(utcIso(expiresAt))}.</> : null}
    </StatusBanner>
  );
}
