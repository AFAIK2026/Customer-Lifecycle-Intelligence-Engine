import { useRef, useState, type ReactNode } from "react";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropZoneProps {
  accept: string;
  title: ReactNode;
  hint: ReactNode;
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  busy?: boolean;
}

/** Drag-and-drop / click-to-browse file picker shared by the upload pages. */
export function DropZone({ accept, title, hint, onFiles, multiple = true, busy = false }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function open() {
    if (!busy) inputRef.current?.click();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={busy}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length > 0 && !busy) onFiles(files);
      }}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={cn(
        "glass-card flex flex-col items-center justify-center gap-3 border-2 border-dashed py-16 text-center transition-colors",
        busy ? "cursor-wait opacity-70" : "cursor-pointer",
        isDragging ? "border-primary bg-primary/5" : "border-border"
      )}
    >
      <UploadCloud size={32} className="text-primary" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-1">{hint}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
