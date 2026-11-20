import {
  FileCode,
  FileSpreadsheet,
  FileText,
  FileType,
  Rows3,
  Table2,
  type LucideIcon,
} from "lucide-react";

const documentTypeIcons: Record<
  string,
  { icon: LucideIcon; className: string; label: string }
> = {
  md: { icon: FileCode, className: "type-markdown", label: "MD" },
  txt: { icon: FileText, className: "type-text", label: "TXT" },
  docx: { icon: FileType, className: "type-word", label: "DOCX" },
  pdf: { icon: FileText, className: "type-pdf", label: "PDF" },
  xlsx: { icon: FileSpreadsheet, className: "type-xlsx", label: "XLSX" },
  xls: { icon: Table2, className: "type-xls", label: "XLS" },
  csv: { icon: Rows3, className: "type-csv", label: "CSV" },
};

export function DocumentFormatIcon({
  fileName,
  className = "",
}: {
  fileName: string;
  className?: string;
}) {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const {
    icon: Icon,
    className: typeClass,
    label,
  } = documentTypeIcons[extension] ?? {
    icon: FileText,
    className: "type-default",
    label: "FILE",
  };
  return (
    <span
      className={`document-format-icon ${typeClass} ${className}`}
      role="img"
      aria-label={`${label} file`}
    >
      <Icon aria-hidden="true" size={18} />
      <b aria-hidden="true">{label}</b>
    </span>
  );
}
