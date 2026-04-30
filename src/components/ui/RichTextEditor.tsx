import { useCallback, useEffect } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Code,
  Code2,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

// Pre-rich-editor descriptions are plain text and may contain real newlines.
// HTML collapses whitespace, so we'd lose multi-line layout if we passed them
// to TipTap as-is. Wrap in <p> and convert \n to <br> when the value doesn't
// look like HTML already.
function normalizeContent(value: string): string {
  if (!value) return "";
  const looksLikeHtml = /<\w+[^>]*>/.test(value);
  if (looksLikeHtml) return value;
  const escaped = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  return `<p>${escaped}</p>`;
}

// TipTap-based WYSIWYG. Stores HTML in `value`. Empty content normalizes to
// the empty string (TipTap reports `<p></p>` for an empty doc — we strip it
// so save payloads don't grow indefinitely with no-op edits).
export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // We render headings via h2/h3 in the toolbar — no h1 because the
        // modal title is already an h1 in the page hierarchy.
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: normalizeContent(value),
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
    editorProps: {
      attributes: {
        // The `prose-editor` class hooks the styles defined in index.css.
        // Generous min-height because most ticket descriptions span several
        // lines (acceptance criteria, repro steps, links). The editor still
        // grows naturally past this when the content needs more room.
        class: "prose-editor input min-h-[280px] focus:outline-none",
      },
    },
  });

  // Keep the editor in sync when `value` changes from the outside (e.g. the
  // modal resets the form when opened on a different ticket). Skip if the
  // current HTML already matches to avoid wiping the user's cursor.
  useEffect(() => {
    if (!editor) return;
    const next = normalizeContent(value);
    if (editor.getHTML() === next) return;
    if (editor.getHTML() === "<p></p>" && !value) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  return (
    <div>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

interface ToolbarProps {
  editor: Editor | null;
}

function Toolbar({ editor }: ToolbarProps) {
  const promptForLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const disabled = !editor;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-0.5 px-1 py-1 mb-1.5",
        "rounded-lg ring-1 ring-inset ring-surface-200 bg-surface-50",
        "dark:ring-surface-700 dark:bg-surface-800/60",
      )}
    >
      <ToolbarButton
        label="Bold"
        icon={Bold}
        active={editor?.isActive("bold") ?? false}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        label="Italic"
        icon={Italic}
        active={editor?.isActive("italic") ?? false}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      />
      <ToolbarButton
        label="Strikethrough"
        icon={Strikethrough}
        active={editor?.isActive("strike") ?? false}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      />

      <ToolbarSeparator />

      <ToolbarButton
        label="Heading 2"
        icon={Heading2}
        active={editor?.isActive("heading", { level: 2 }) ?? false}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolbarButton
        label="Heading 3"
        icon={Heading3}
        active={editor?.isActive("heading", { level: 3 }) ?? false}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
      />

      <ToolbarSeparator />

      <ToolbarButton
        label="Bullet list"
        icon={List}
        active={editor?.isActive("bulletList") ?? false}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        label="Numbered list"
        icon={ListOrdered}
        active={editor?.isActive("orderedList") ?? false}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        label="Quote"
        icon={Quote}
        active={editor?.isActive("blockquote") ?? false}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      />

      <ToolbarSeparator />

      <ToolbarButton
        label="Inline code"
        icon={Code}
        active={editor?.isActive("code") ?? false}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleCode().run()}
      />
      <ToolbarButton
        label="Code block"
        icon={Code2}
        active={editor?.isActive("codeBlock") ?? false}
        disabled={disabled}
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
      />

      <ToolbarSeparator />

      <ToolbarButton
        label="Link"
        icon={LinkIcon}
        active={editor?.isActive("link") ?? false}
        disabled={disabled}
        onClick={promptForLink}
      />
    </div>
  );
}

interface ToolbarButtonProps {
  label: string;
  icon: typeof Bold;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}

function ToolbarButton({ label, icon: Icon, active, disabled, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "p-1.5 rounded transition-colors",
        active
          ? "bg-surface-900 text-white dark:bg-surface-100 dark:text-surface-900"
          : "text-surface-600 hover:bg-surface-200 hover:text-surface-900 dark:text-surface-300 dark:hover:bg-surface-700 dark:hover:text-surface-50",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function ToolbarSeparator() {
  return <span className="mx-1 h-4 w-px bg-surface-200 dark:bg-surface-700" aria-hidden="true" />;
}
