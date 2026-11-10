import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight, Copy, Crop, Download, Highlighter, Minus, Pencil, Redo2, Square, Type, Undo2, X,
} from 'lucide-react';
import { userFacingError } from './userFacingError';
import './screenshot.css';

type ImageSource = { dataUrl: string; width: number; height: number };
type Point = { x: number; y: number };
type Area = Point & { width: number; height: number };
type Tool = 'select' | 'pen' | 'line' | 'arrow' | 'box' | 'marker' | 'text';
type Mark = { tool: Exclude<Tool, 'select'>; color: string; points: Point[]; text?: string };
const tools = [
  { id: 'select', label: 'Выделить область', Icon: Crop },
  { id: 'pen', label: 'Карандаш', Icon: Pencil },
  { id: 'line', label: 'Линия', Icon: Minus },
  { id: 'arrow', label: 'Стрелка', Icon: ArrowUpRight },
  { id: 'box', label: 'Прямоугольник', Icon: Square },
  { id: 'marker', label: 'Маркер', Icon: Highlighter },
  { id: 'text', label: 'Текст', Icon: Type },
] as const;
const maxMarks = 150;

function rect(start: Point, end: Point): Area {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
}

function drawMark(context: CanvasRenderingContext2D, mark: Mark): void {
  const first = mark.points[0];
  const last = mark.points[mark.points.length - 1];
  context.save();
  context.lineWidth = mark.tool === 'marker' ? 18 : 4;
  context.strokeStyle = context.fillStyle = mark.color;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (mark.tool === 'marker') context.globalAlpha = 0.36;
  context.beginPath();
  if (mark.tool === 'text') {
    context.font = '600 24px system-ui, sans-serif';
    context.textBaseline = 'top';
    context.fillText(mark.text || '', first.x, first.y);
  } else if (mark.tool === 'box') {
    const area = rect(first, last);
    context.strokeRect(area.x, area.y, area.width, area.height);
  } else {
    context.moveTo(first.x, first.y);
    if (mark.tool === 'pen' || mark.tool === 'marker') {
      for (const point of mark.points.slice(1)) context.lineTo(point.x, point.y);
    } else {
      context.lineTo(last.x, last.y);
      if (mark.tool === 'arrow') {
        const angle = Math.atan2(last.y - first.y, last.x - first.x);
        const size = Math.min(18, Math.hypot(last.x - first.x, last.y - first.y) * 0.55);
        for (const offset of [-Math.PI / 6, Math.PI / 6]) {
          context.moveTo(last.x, last.y);
          context.lineTo(last.x - size * Math.cos(angle + offset), last.y - size * Math.sin(angle + offset));
        }
      }
    }
    context.stroke();
  }
  context.restore();
}

export default function ScreenshotEditor({ image, onClose }: { image: ImageSource; onClose: () => void }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  const source = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{ pointer: number; start: Point; mark?: Mark } | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState('#f04748');
  const [text, setText] = useState('');
  const [selection, setSelection] = useState<Area>();
  const [selectionDraft, setSelectionDraft] = useState<Area>();
  const [draft, setDraft] = useState<Mark>();
  const [marks, setMarks] = useState<Mark[]>([]);
  const [redo, setRedo] = useState<Mark[]>([]);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeArea = selectionDraft ?? selection;

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, image.width, image.height);
    for (const mark of marks) drawMark(context, mark);
    if (draft) drawMark(context, draft);
  }, [image.width, image.height, marks, draft]);

  const pointAt = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(image.width, Math.round((event.clientX - bounds.left) * image.width / bounds.width))),
      y: Math.max(0, Math.min(image.height, Math.round((event.clientY - bounds.top) * image.height / bounds.height))),
    };
  };
  const add = (mark: Mark) => {
    setMarks(previous => [...previous, mark]);
    setRedo([]);
  };
  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || busy || gesture.current) return;
    const start = pointAt(event);
    setError('');
    setFeedback('');
    if (tool !== 'select') {
      if (!selection || marks.length >= maxMarks) return;
      if (start.x < selection.x || start.y < selection.y || start.x >= selection.x + selection.width || start.y >= selection.y + selection.height) return;
      if (tool === 'text') {
        if (!text.trim()) setError('Введите текст для подписи.');
        else add({ tool, color, points: [start], text: text.trim() });
        return;
      }
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const mark = tool === 'select' ? undefined : { tool, color, points: [start, start] };
    gesture.current = { pointer: event.pointerId, start, mark };
    if (mark) setDraft(mark);
    else setSelectionDraft(rect(start, start));
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const point = pointAt(event);
    if (!current.mark) {
      setSelectionDraft(rect(current.start, point));
    } else {
      const mark = current.mark;
      const freehand = mark.tool === 'pen' || mark.tool === 'marker';
      const points = freehand && mark.points.length < 2048 ? [...mark.points, point] : [...mark.points.slice(0, -1), point];
      current.mark = { ...mark, points };
      setDraft(current.mark);
    }
  };
  const finish = (event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    gesture.current = null;
    setSelectionDraft(undefined);
    setDraft(undefined);
    if (cancelled) return;
    const end = pointAt(event);
    if (!current.mark) {
      const area = rect(current.start, end);
      if (area.width >= 2 && area.height >= 2) setSelection(area);
      return;
    }
    add({ ...current.mark, points: [...current.mark.points, end] });
  };
  const undo = () => {
    const last = marks.at(-1);
    if (!last) return;
    setRedo(previous => [...previous, last]);
    setMarks(previous => previous.slice(0, -1));
  };
  const redoMark = () => {
    const last = redo.at(-1);
    if (!last) return;
    setMarks(previous => [...previous, last]);
    setRedo(previous => previous.slice(0, -1));
  };
  const exportImage = async (action: 'copy' | 'save') => {
    if (busy || !selection || !source.current?.naturalWidth) return;
    setError('');
    setFeedback('');
    setBusy(true);
    try {
      const cropped = document.createElement('canvas');
      cropped.width = selection.width;
      cropped.height = selection.height;
      const context = cropped.getContext('2d');
      if (!context) throw new Error('Не удалось создать снимок.');
      context.drawImage(source.current, selection.x, selection.y, selection.width, selection.height, 0, 0, selection.width, selection.height);
      context.translate(-selection.x, -selection.y);
      marks.forEach(mark => drawMark(context, mark));
      if (await window.browserApi.exportTabScreenshot(cropped.toDataURL('image/png'), action)) {
        setFeedback(action === 'copy' ? 'Снимок скопирован' : 'Снимок сохранён');
      }
    } catch (failure) {
      setError(userFacingError(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="screenshot-editor" aria-labelledby="screenshot-title">
      <header className="screenshot-heading">
        <div><h1 ref={heading} id="screenshot-title" tabIndex={-1}>Снимок вкладки</h1><p>Выделите нужную область мышью или выберите весь снимок.</p></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть редактор снимка"><X size={18} /></button>
      </header>
      <div className="screenshot-tools" role="group" aria-label="Инструменты снимка">
        {tools.map(({ id, label, Icon }) => <button key={id} type="button" className="plain-button" title={label}
          aria-label={label} aria-pressed={tool === id} disabled={id !== 'select' && (!selection || marks.length >= maxMarks)}
          onClick={() => setTool(id)}><Icon size={16} aria-hidden="true" /></button>)}
        <label>Цвет <input type="color" aria-label="Цвет разметки" value={color} onChange={event => setColor(event.target.value)} /></label>
        <button type="button" className="plain-button" onClick={undo} disabled={!marks.length} aria-label="Отменить штрих"><Undo2 size={16} /></button>
        <button type="button" className="plain-button" onClick={redoMark} disabled={!redo.length} aria-label="Повторить штрих"><Redo2 size={16} /></button>
        <button type="button" className="plain-button" onClick={() => setSelection({ x: 0, y: 0, width: image.width, height: image.height })}>Весь снимок</button>
      </div>
      {tool === 'text' && <label className="screenshot-text">Текст подписи
        <input value={text} maxLength={120} onChange={event => setText(event.target.value)} placeholder="Текст появится в точке клика" />
      </label>}
      <div className="screenshot-stage" style={{ maxWidth: `min(${image.width}px, ${64 * image.width / image.height}vh)` }}>
        <img ref={source} src={image.dataUrl} width={image.width} height={image.height} alt="Снимок видимой области сайта" draggable={false} />
        <canvas ref={canvas} data-tool={tool} width={image.width} height={image.height}
          onPointerDown={begin} onPointerMove={move} onPointerUp={finish}
          onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
          aria-label="Область редактирования снимка" />
        {activeArea && <div className="screenshot-selection" aria-hidden="true" style={{
          left: `${activeArea.x / image.width * 100}%`, top: `${activeArea.y / image.height * 100}%`,
          width: `${activeArea.width / image.width * 100}%`, height: `${activeArea.height / image.height * 100}%`,
        }} />}
      </div>
      <footer className="screenshot-footer">
        <span>{selection ? `${selection.width} × ${selection.height} px` : 'Область не выбрана'}</span>
        <button type="button" className="plain-button" disabled={!selection || busy} onClick={() => void exportImage('copy')}><Copy size={16} /> Копировать</button>
        <button type="button" className="primary-button" disabled={!selection || busy} onClick={() => void exportImage('save')}><Download size={16} /> Сохранить PNG</button>
        {feedback && <span role="status">{feedback}</span>}
      </footer>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
