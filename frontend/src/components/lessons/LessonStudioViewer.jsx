import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Search,
  UserCircle2,
  PlayCircle,
  LayoutGrid,
  Home,
  FileText,
  MessageCircle,
  ScrollText,
  Users,
  User,
  PenSquare,
  SlidersHorizontal,
  Sparkles,
  Target,
  PenLine,
  Crosshair,
  Eraser,
  DoorOpen
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import WhiteboardModal from '../library/WhiteboardModal';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';

const LessonStudioViewer = ({ lesson, onClose }) => {
  const { user, socket } = useAuth();
  const [branding, setBranding] = useState({ title: 'Waraqa', slogan: '', logoUrl: null });
  const [activeSection, setActiveSection] = useState(0);
  const [audience, setAudience] = useState('adults');
  const [level, setLevel] = useState('beginner');
  const [kidStyle, setKidStyle] = useState('boy');
  const viewerRole = user?.role || 'teacher';
  const instructorName =
    user?.fullName ||
    `${user?.firstName || ''} ${user?.lastName || ''}`.trim() ||
    user?.email ||
    'Instructor';
  const [learnerName, setLearnerName] = useState('');
  const [showWelcome, setShowWelcome] = useState(true);
  const [studentQuery, setStudentQuery] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState('');
  const [studentOptions, setStudentOptions] = useState([]);
  const studentInputRef = useRef(null);
  const [hadithText, setHadithText] = useState('');
  const [activePanel, setActivePanel] = useState('explanation');
  const stageTheme = useMemo(() => ({
    gradient: 'from-slate-200 via-slate-100 to-slate-200',
    border: 'border-slate-200',
    accent: 'text-slate-600',
    card: 'border-slate-200 bg-white/90',
    note: 'border-slate-200 bg-white/90',
    ring: 'ring-slate-200/60'
  }), []);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [teacherMarks, setTeacherMarks] = useState({});
  const EXAMPLES_STEP = 10;
  const [visibleExamplesCount, setVisibleExamplesCount] = useState(EXAMPLES_STEP);
  const [practicedExamples, setPracticedExamples] = useState({});
  const [annotatorTool, setAnnotatorTool] = useState('none');
  const wrapperRef = useRef(null);
  const penCanvasRef = useRef(null);
  const laserCanvasRef = useRef(null);
  const overlayRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);

  // Load public branding so the lesson stage uses the same logo as dashboard sidebar/favicon.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cacheKey = makeCacheKey('branding:public');
        const cached = readCache(cacheKey, { deps: ['branding'] });
        if (cached.hit && cached.value?.branding) {
          const b = cached.value.branding;
          const title = b?.title || 'Waraqa';
          const slogan = b?.slogan || '';
          const logoUrl = b?.logo?.url || b?.logo?.dataUri || null;
          if (mounted) setBranding({ title, slogan, logoUrl });
          if (cached.ageMs < 5 * 60_000) return;
        }

        const res = await api.get('/settings/branding');
        const b = res?.data?.branding;
        const title = b?.title || 'Waraqa';
        const slogan = b?.slogan || '';
        const logoUrl = b?.logo?.url || b?.logo?.dataUri || null;
        if (mounted) setBranding({ title, slogan, logoUrl });
        writeCache(cacheKey, { branding: b || { title, slogan, logo: logoUrl ? { url: logoUrl } : null } }, { ttlMs: 5 * 60_000, deps: ['branding'] });
      } catch (e) {
        // ignore branding load errors
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Live update when admin changes branding
  useEffect(() => {
    if (!socket) return;
    const handler = (payload) => {
      try {
        const b = payload?.branding;
        if (!b) return;
        const title = b?.title || 'Waraqa';
        const slogan = b?.slogan || '';
        const logoUrl = b?.logo?.url || b?.logo?.dataUri || null;
        setBranding({ title, slogan, logoUrl });
        const cacheKey = makeCacheKey('branding:public');
        writeCache(cacheKey, { branding: b }, { ttlMs: 5 * 60_000, deps: ['branding'] });
      } catch (_) {}
    };
    socket.on('branding:updated', handler);
    return () => socket.off('branding:updated', handler);
  }, [socket]);

  if (!lesson) return null;
  const meta = lesson.metadata?.lessonStudio || lesson.metadata?.testStudio || {};
  const isTest = Boolean(lesson.metadata?.testStudio);
  const sections = Array.isArray(meta.sections) ? meta.sections : [];
  const current = sections[activeSection] || {};
  const filteredStudents = useMemo(() => {
    const query = studentQuery.trim().toLowerCase();
    if (query.length < 3) return [];
    return studentOptions
      .filter((student) => student.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [studentOptions, studentQuery]);
  const resolveLearnerName = () => {
    if (selectedStudent?.name) return selectedStudent.name;
    const typed = studentQuery.trim();
    return typed || '';
  };
  const handleStartLesson = (sectionIndex = 0) => {
    const resolved = resolveLearnerName();
    if (resolved) setLearnerName(resolved);
    setActiveSection(sectionIndex);
    setActivePanel('explanation');
    setShowWelcome(false);
  };
  const handleGoHome = () => {
    setShowWelcome(true);
    setActivePanel('explanation');
  };

  useEffect(() => {
    if (!showWelcome) return;
    if (!user) return;
    if (studentQuery.trim().length < 3) {
      setStudentOptions([]);
      setStudentsLoading(false);
      setStudentsError('');
      return;
    }
    const role = user?.role;
    const userId = user?._id || user?.id;
    let active = true;
    const fetchStudents = async () => {
      try {
        setStudentsError('');
        setStudentsLoading(true);
        if (role === 'admin') {
          const res = await api.get('/users/admin/all-students', {
            params: {
              search: studentQuery || undefined,
              limit: 50,
              light: true
            }
          });
          const list = Array.isArray(res.data?.students) ? res.data.students : [];
          const mapped = list
            .map((student) => {
              const name =
                student.fullName ||
                `${student.firstName || ''} ${student.lastName || ''}`.trim() ||
                student.name ||
                student.email ||
                '';
              if (!name) return null;
              return { id: student._id || student.id || name, name };
            })
            .filter(Boolean);
          if (active) setStudentOptions(mapped);
          return;
        }
        if (role === 'teacher' && userId) {
          const res = await api.get(`/users/teacher/${userId}/students`);
          const list = Array.isArray(res.data?.students) ? res.data.students : [];
          const mapped = list
            .map((student) => {
              const name =
                student.fullName ||
                `${student.firstName || ''} ${student.lastName || ''}`.trim() ||
                student.name ||
                student.email ||
                '';
              if (!name) return null;
              return { id: student._id || student.id || name, name };
            })
            .filter(Boolean);
          if (active) setStudentOptions(mapped);
          return;
        }
        if (active) setStudentOptions([]);
      } catch (error) {
        if (active) {
          setStudentsError('Unable to load students.');
          setStudentOptions([]);
        }
      } finally {
        if (active) setStudentsLoading(false);
      }
    };
    const debounce = setTimeout(fetchStudents, 250);
    return () => {
      active = false;
      clearTimeout(debounce);
    };
  }, [showWelcome, user, studentQuery]);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('presenterSettings') || '{}');
      const list = Array.isArray(raw.hadithList) ? raw.hadithList.filter(Boolean) : [];
      if (list.length) {
        const pick = list[Math.floor(Math.random() * list.length)];
        setHadithText(pick);
      }
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    setQuestionIndex(0);
    setVisibleExamplesCount(EXAMPLES_STEP);
    setPracticedExamples({});
  }, [activeSection]);

  useEffect(() => {
    const target = overlayRef.current;
    if (!target) return undefined;
    const resize = () => {
      const rect = target.getBoundingClientRect();
      [penCanvasRef.current, laserCanvasRef.current].forEach((canvas) => {
        if (!canvas) return;
        canvas.width = rect.width;
        canvas.height = rect.height;
      });
    };
    resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(target);
    window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  const getPoint = (event) => {
    const target = event.currentTarget;
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const drawLine = (ctx, from, to, color, width, alpha = 1) => {
    if (!ctx || !from || !to) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  };

  const handlePointerDown = (event) => {
    if (annotatorTool === 'none') return;
    drawingRef.current = true;
    lastPointRef.current = getPoint(event);
  };

  const handlePointerMove = (event) => {
    if (!drawingRef.current || annotatorTool === 'none') return;
    const nextPoint = getPoint(event);
    const prevPoint = lastPointRef.current;
    if (!nextPoint || !prevPoint) return;
    if (annotatorTool === 'pen') {
      const ctx = penCanvasRef.current?.getContext('2d');
      drawLine(ctx, prevPoint, nextPoint, '#0f172a', 2, 1);
    } else if (annotatorTool === 'laser') {
      const ctx = laserCanvasRef.current?.getContext('2d');
      drawLine(ctx, prevPoint, nextPoint, '#ef4444', 3, 0.9);
      if (laserCanvasRef.current) {
        const canvas = laserCanvasRef.current;
        setTimeout(() => {
          const clearCtx = canvas.getContext('2d');
          clearCtx?.clearRect(0, 0, canvas.width, canvas.height);
        }, 300);
      }
    }
    lastPointRef.current = nextPoint;
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
    if (annotatorTool === 'laser') {
      setAnnotatorTool('none');
    }
  };

  const sectionTabs = useMemo(
    () =>
      sections.map((section, idx) => ({
        label: section.title || `Section ${idx + 1}`,
        index: idx
      })),
    [sections]
  );

  const getExplanationValue = (audienceKey, levelKey) => current.explanation?.[audienceKey]?.[levelKey];

  const normalizeExplanationBlocks = (value) => {
    if (!Array.isArray(value)) return [];
    return value.map((block, index) => ({
      id: block?.id || `block-${Date.now()}-${index}`,
      title: block?.title || 'Explanation',
      style: block?.style || 'sky',
      content: block?.content || block?.text || '',
      mediaUrl: block?.mediaUrl || ''
    }));
  };

  const normalizeExplanationParts = (value) => {
    if (Array.isArray(value)) {
      return value.map((part) => ({
        text: part?.text || '',
        mediaUrl: part?.mediaUrl || ''
      }));
    }
    if (typeof value === 'string' && value.trim()) {
      return [{ text: value, mediaUrl: '' }];
    }
    if (value && typeof value === 'object') {
      return [{ text: value.text || '', mediaUrl: value.mediaUrl || '' }];
    }
    return [];
  };

  const getExplanationParts = (audienceKey, levelKey) => {
    const value = normalizeExplanationParts(getExplanationValue(audienceKey, levelKey));
    if (value.length) return value;
    return normalizeExplanationParts(getExplanationValue('adults', levelKey));
  };

  const examples = (current.examples || []).filter(Boolean);
  const notes = (current.notes || []).filter(Boolean);
  const questions = (current.questions || []).filter(Boolean);
  const currentQuestion = questions[questionIndex];
  const answerKey = `${activeSection}-${questionIndex}`;
  const exampleBorderPalette = [
    'border-emerald-300',
    'border-sky-300',
    'border-amber-300',
    'border-rose-300',
    'border-violet-300',
    'border-teal-300',
    'border-lime-300',
    'border-indigo-300'
  ];
  const sectionButtonPalette = [
    'border-emerald-300 bg-emerald-50 text-emerald-800',
    'border-sky-300 bg-sky-50 text-sky-800',
    'border-amber-300 bg-amber-50 text-amber-800',
    'border-rose-300 bg-rose-50 text-rose-800',
    'border-violet-300 bg-violet-50 text-violet-800',
    'border-teal-300 bg-teal-50 text-teal-800',
    'border-lime-300 bg-lime-50 text-lime-800',
    'border-indigo-300 bg-indigo-50 text-indigo-800'
  ];

  const kidTone = kidStyle === 'boy'
    ? { label: 'Brave hero', tone: 'He' }
    : { label: 'Bright star', tone: 'She' };

  const explanationBorder = audience === 'kids'
    ? kidStyle === 'boy'
      ? 'border-sky-300'
      : 'border-pink-300'
    : 'border-amber-300';

  const noteBorder = audience === 'kids'
    ? kidStyle === 'boy'
      ? 'border-blue-300'
      : 'border-rose-300'
    : 'border-amber-300';

  const explanationBlocks = normalizeExplanationBlocks(
    audience === 'kids'
      ? (current?.explanationBlocksKids || current?.explanationBlocks)
      : (current?.explanationBlocksStandard || current?.explanationBlocks)
  );
  const selectedExplanationParts = getExplanationParts(audience, level);
  const definitionText = current?.definition || '';
  const explanationParts = selectedExplanationParts.length
    ? selectedExplanationParts
    : [{ text: '—', mediaUrl: '' }];
  const hasBlocks = explanationBlocks.length > 0;
  const showObjective = Boolean(meta.objective);
    const renderRichText = (value) => ({ __html: value || '' });
  const objectiveList = useMemo(() => {
    if (!meta.objective) return [];
    if (Array.isArray(meta.objective)) return meta.objective.filter(Boolean).map(String);
    if (typeof meta.objective === 'string') {
      const parts = meta.objective
        .split(/\n|•/)
        .map((item) => item.trim())
        .filter(Boolean);
      return parts.length ? parts : [meta.objective.trim()];
    }
    return [String(meta.objective)];
  }, [meta.objective]);

  const getFirstWord = (value) => {
    if (!value) return '';
    const plain = String(value)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim();
    const match = plain.match(/\S+/);
    return match ? match[0] : '';
  };

  const isArabicWord = (word) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(word || '');

  const getDirectionFromFirstWord = (value) => {
    const word = getFirstWord(value);
    return isArabicWord(word) ? { dir: 'rtl', align: 'text-right' } : { dir: 'ltr', align: 'text-left' };
  };

  const contentSample = [
    ...(hasBlocks ? explanationBlocks.map((block) => block?.content || '') : explanationParts.map((part) => part?.text || '')),
    ...(examples || []),
    ...(notes || [])
  ].join(' ');
  const isArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(contentSample);
  const contentDir = isArabic ? 'rtl' : 'ltr';
  const contentAlign = isArabic ? 'text-right' : 'text-left';
  const noteDirection = getDirectionFromFirstWord((notes || [])[0]);

  const togglePracticed = (key) => {
    setPracticedExamples((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const visibleExamples = examples.slice(0, visibleExamplesCount);
  const canShowMoreExamples = visibleExamplesCount < examples.length;

  const buildExampleItems = (list) => {
    const items = [];
    (list || []).forEach((raw, idx) => {
      const text = typeof raw === 'string' ? raw : '';
      if (!text.trim()) return;
      const lines = text.split('\n');
      lines.forEach((line, lineIdx) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed === '---') {
          items.push({ type: 'separator', key: `sep-${idx}-${lineIdx}` });
        } else {
          items.push({ type: 'example', text: trimmed, key: `ex-${idx}-${lineIdx}` });
        }
      });
    });
    return items;
  };

  const getExampleSizeClass = (text) => {
    const len = (text || '').length;
    if (len > 120) return 'text-xs';
    if (len > 90) return 'text-sm';
    if (len > 60) return 'text-base';
    if (len > 35) return 'text-lg';
    if (len > 20) return 'text-xl';
    return 'text-2xl';
  };

  const renderExamplesInline = (list) => {
    const items = buildExampleItems(list);
    const exampleItems = items.filter((item) => item.type === 'example');
    const shortCount = exampleItems.filter((item) => (item.text || '').length <= 8).length;
    const shortRatio = exampleItems.length ? shortCount / exampleItems.length : 0;
    const denseGrid = shortRatio >= 0.6;
    const gridClass = denseGrid
      ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
    const hasLong = exampleItems.some((item) => (item.text || '').length > 60);
    const gapClass = hasLong ? 'gap-1' : 'gap-2';
    const alignmentClass = isArabic ? 'justify-items-end text-right' : 'justify-items-start text-left';
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
        <div className={`grid ${gapClass} grid-flow-dense ${gridClass} ${alignmentClass}`}>
          {items.map((item, idx) => {
            if (item.type === 'separator') {
              return (
                <div
                  key={item.key}
                  className={`my-2 h-px w-full bg-slate-200 ${denseGrid ? 'sm:col-span-3 md:col-span-4 lg:col-span-5' : 'sm:col-span-2 lg:col-span-3'}`}
                />
              );
            }
            const isPracticed = practicedExamples[item.key];
            const nextItem = items[idx + 1];
            const showComma = nextItem && nextItem.type === 'example';
            const len = (item.text || '').length;
            const spanClass = denseGrid
              ? len > 90
                ? 'sm:col-span-3 md:col-span-4 lg:col-span-5'
                : len > 60
                  ? 'sm:col-span-2 md:col-span-3 lg:col-span-4'
                  : len > 35
                    ? 'sm:col-span-2 md:col-span-2 lg:col-span-3'
                    : 'col-span-1'
              : len > 90
                ? 'sm:col-span-2 lg:col-span-3'
                : len > 60
                  ? 'sm:col-span-2 lg:col-span-2'
                  : 'col-span-1';
            const textAlignClass = len > 60 ? 'text-center' : (isArabic ? 'text-right' : 'text-left');
            return (
              <div key={item.key} className={`flex items-center ${spanClass}`}>
                <span
                  onClick={() => togglePracticed(item.key)}
                  className={`cursor-pointer rounded-xl border px-5 py-3 font-semibold break-words whitespace-normal ${
                    exampleBorderPalette[idx % exampleBorderPalette.length]
                  } ${
                    isPracticed
                      ? 'bg-slate-300/80 shadow-none'
                      : 'bg-slate-50/90 shadow-sm hover:shadow-md'
                  } ${getExampleSizeClass(item.text)} ${textAlignClass} min-w-[140px] w-full`}
                >
                  {item.text}
                </span>
                {showComma && <span className="ml-1 text-slate-400">،</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const resolveQuestionOptions = (question) => {
    if (!question) return [];
    if (question.type === 'correct-incorrect') return ['Correct', 'Incorrect'];
    return question.options || [];
  };

  const resolveCorrectIndex = (question) => {
    if (!question) return null;
    if (question.type === 'correct-incorrect' && typeof question.isCorrect === 'boolean') {
      return question.isCorrect ? 0 : 1;
    }
    if (Number.isFinite(question.answerIndex)) return question.answerIndex;
    return null;
  };

  const questionOptions = resolveQuestionOptions(currentQuestion);
  const questionSample = [
    currentQuestion?.prompt || '',
    ...(questionOptions || [])
  ].join(' ');
  const questionIsArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(questionSample);
  const correctIndex = resolveCorrectIndex(currentQuestion);
  const selectedIndex = answers[answerKey];
  const isCorrect = Number.isFinite(correctIndex) && selectedIndex === correctIndex;
  const isWrong = Number.isFinite(correctIndex) && selectedIndex != null && selectedIndex !== correctIndex;
  const teacherMark = teacherMarks[answerKey];
  const questionPoints = (question) => {
    const value = Number(question?.points);
    return Number.isFinite(value) ? value : 0;
  };
  const totalPoints = isTest
    ? questions.reduce((sum, q) => sum + questionPoints(q), 0)
    : 0;
  const earnedPoints = isTest
    ? questions.reduce((sum, q, idx) => {
        const key = `${activeSection}-${idx}`;
        const correctIdx = resolveCorrectIndex(q);
        const selected = answers[key];
        const correct = Number.isFinite(correctIdx) && selected === correctIdx;
        const markedCorrect = teacherMarks[key] === 'correct';
        return sum + ((correct || markedCorrect) ? questionPoints(q) : 0);
      }, 0)
    : 0;

  return (
    <div ref={wrapperRef} className={`relative flex h-full min-h-full flex-col overflow-hidden rounded-3xl border ${stageTheme.border} bg-gradient-to-br ${stageTheme.gradient} p-6 shadow-xl ring-1 ${stageTheme.ring}`}>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-48 w-[70%] -translate-x-1/2 rounded-b-[999px] bg-gradient-to-b from-white/90 via-white/40 to-transparent" />
        <div className={`absolute top-6 left-10 h-16 w-16 rounded-full border ${stageTheme.border} opacity-70`} />
        <div className={`absolute top-14 right-16 h-10 w-10 rounded-full border ${stageTheme.border} opacity-60`} />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12px_12px,rgba(148,163,184,0.16)_1px,transparent_1px)] bg-[length:24px_24px]" />
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-r from-white/80 via-white to-white/80" />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <img
              src={branding.logoUrl || `${import.meta.env.BASE_URL}favicon.svg`}
              alt={branding.title || 'Waraqa'}
              className="h-[72px] w-[72px] rounded-full border border-slate-200 bg-white"
            />
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Lesson stage</p>
              <h2 className="text-2xl font-semibold text-foreground">{lesson.displayName || 'Lesson preview'}</h2>
              <p className="text-sm text-muted-foreground">{lesson.subject || meta.subject || 'General'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className={`flex flex-wrap items-center gap-2 rounded-full border ${stageTheme.border} bg-white/90 px-2 py-1.5`}>
              <button
                type="button"
                onClick={() => setAnnotatorTool((prev) => (prev === 'pen' ? 'none' : 'pen'))}
                className={`rounded-full border p-2.5 text-sm font-semibold transition ${
                  annotatorTool === 'pen'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                }`}
                title="Pen"
              >
                <PenLine className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setAnnotatorTool((prev) => (prev === 'laser' ? 'none' : 'laser'))}
                className={`rounded-full border p-2.5 text-sm font-semibold transition ${
                  annotatorTool === 'laser'
                    ? 'bg-rose-500 text-white shadow'
                    : 'border-rose-200 text-rose-600 hover:bg-rose-50'
                }`}
                title="Laser"
              >
                <Crosshair className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (penCanvasRef.current) {
                    const ctx = penCanvasRef.current.getContext('2d');
                    ctx?.clearRect(0, 0, penCanvasRef.current.width, penCanvasRef.current.height);
                  }
                }}
                className="rounded-full border border-slate-200 p-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                title="Clear pen"
              >
                <Eraser className="h-5 w-5" />
              </button>
            </div>
            <div className={`flex flex-wrap items-center gap-2 rounded-full border ${stageTheme.border} bg-white/90 px-2 py-1.5`}>
              {['standard', 'kids'].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setAudience(item === 'standard' ? 'adults' : 'kids')}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                    (audience === 'adults' && item === 'standard') || (audience === 'kids' && item === 'kids')
                      ? item === 'kids'
                        ? 'bg-sky-500 text-white shadow'
                        : 'bg-amber-500 text-white shadow'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className={`flex flex-wrap items-center gap-2 rounded-full border ${stageTheme.border} bg-white/90 px-2 py-1.5`}>
              {['beginner', 'advanced'].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setLevel(item)}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                    level === item
                      ? item === 'advanced'
                        ? 'bg-indigo-500 text-white shadow'
                        : 'bg-emerald-500 text-white shadow'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            {audience === 'kids' && (
              <div className={`flex flex-wrap items-center gap-2 rounded-full border ${stageTheme.border} bg-white/90 px-2 py-1.5`}>
                {['boy', 'girl'].map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setKidStyle(item)}
                    className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                      kidStyle === item
                        ? item === 'boy'
                          ? 'bg-sky-500 text-white shadow'
                          : 'bg-pink-500 text-white shadow'
                        : 'text-slate-700 hover:bg-white'
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="ml-4 inline-flex h-11 w-11 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 shadow-sm hover:bg-amber-100"
                title="Exit"
              >
                <DoorOpen className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">
            {sectionTabs.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {sectionTabs.map((tab) => (
                  <button
                    key={tab.index}
                    type="button"
                    onClick={() => setActiveSection(tab.index)}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                      tab.index === activeSection
                        ? 'border-slate-900 bg-white text-slate-900 shadow'
                        : 'border-slate-200 bg-white/90 text-slate-600 hover:bg-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            <div className="relative mt-4 flex min-h-0 flex-1 items-stretch gap-4">
              <div
                ref={overlayRef}
                className={`absolute inset-0 z-20 ${annotatorTool === 'none' ? 'pointer-events-none' : 'pointer-events-auto'}`}
              >
                <canvas
                  ref={penCanvasRef}
                  className={`absolute inset-0 h-full w-full ${annotatorTool === 'pen' ? 'cursor-crosshair' : 'cursor-default'}`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                />
                <canvas
                  ref={laserCanvasRef}
                  className={`absolute inset-0 h-full w-full ${annotatorTool === 'laser' ? 'cursor-crosshair' : 'cursor-default'}`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                />
              </div>
              <div className="min-w-0 flex-1 flex min-h-0">
                <div className="mt-1 flex h-full min-h-0 flex-1 flex-col">
                  <div className={`flex h-full min-h-0 flex-1 flex-col rounded-3xl border p-4 shadow-sm ${stageTheme.card}`}>
                    {!showWelcome && (
                      <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                        <ScrollText className="h-5 w-5" />
                        {current.title || 'Section'}
                      </div>
                    )}

                <div
                  className={`mt-4 h-[60vh] flex-1 min-h-[60vh] ${
                    showWelcome
                      ? 'overflow-hidden'
                      : activePanel === 'board'
                        ? 'overflow-hidden'
                        : 'max-h-[55vh] overflow-y-auto pr-1'
                  }`}
                >
                  {showWelcome ? (
                    <div className="flex min-h-full flex-1 flex-col">
                      <div className="flex min-h-[60vh] h-full flex-col rounded-3xl border border-[#2C736C]/20 bg-gradient-to-br from-[#E6F3F1] via-white to-slate-100 p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-6">
                          <div className="flex items-start gap-4">
                            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-white">
                              <img
                                src={branding.logoUrl || `${import.meta.env.BASE_URL}favicon.svg`}
                                alt={branding.title || 'Waraqa'}
                                className="h-10 w-10"
                              />
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Waraqa interactive learning</p>
                              <h3 className="text-2xl font-semibold text-slate-900">{lesson.displayName || 'Lesson topic'}</h3>
                              <p className="text-sm text-slate-500">{lesson.subject || meta.subject || 'Subject'}</p>
                            </div>
                          </div>

                          <div className="w-full max-w-sm relative">
                            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search student</label>
                            <div className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                              <Search className="h-4 w-4 text-slate-400" />
                              <input
                                ref={studentInputRef}
                                type="text"
                                value={selectedStudent?.name || studentQuery}
                                onChange={(event) => {
                                  if (selectedStudent) {
                                    setSelectedStudent(null);
                                  }
                                  setStudentQuery(event.target.value);
                                }}
                                placeholder="Search student"
                                className="w-full bg-transparent text-sm text-slate-700 outline-none"
                              />
                              {selectedStudent && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedStudent(null);
                                    setStudentQuery('');
                                    studentInputRef.current?.focus();
                                  }}
                                  className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                                  title="Clear selection"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                            {(studentsLoading || studentsError || studentQuery.trim().length >= 3) && (
                              <div className="absolute left-0 right-0 mt-2 max-h-64 overflow-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl z-50">
                                {studentsLoading && (
                                  <div className="px-2 py-2 text-xs text-slate-500">Loading students...</div>
                                )}
                                {studentsError && (
                                  <div className="px-2 py-2 text-xs text-rose-500">{studentsError}</div>
                                )}
                                {!studentsLoading && !studentsError && studentQuery.trim().length >= 3 && filteredStudents.length === 0 && (
                                  <div className="px-2 py-2 text-xs text-slate-500">No students found.</div>
                                )}
                                {!studentsLoading && !studentsError && filteredStudents.map((student) => (
                                  <button
                                    key={student.id}
                                    type="button"
                                    onClick={() => {
                                      setSelectedStudent(student);
                                      setStudentQuery('');
                                      studentInputRef.current?.focus();
                                    }}
                                    className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                                      selectedStudent?.id === student.id
                                        ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    <UserCircle2 className="h-4 w-4 text-emerald-500" />
                                    <span className="font-semibold">{student.name}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 flex justify-center">
                          <button
                            type="button"
                            onClick={() => handleStartLesson(0)}
                            className="inline-flex items-center justify-center rounded-full bg-[#2C736C] px-8 py-2.5 text-base font-semibold text-white shadow-sm hover:bg-[#245b56]"
                          >
                            Begin lesson
                          </button>
                        </div>

                        {sections.length > 1 && (
                          <div className="mt-4">
                            <p className="text-sm font-semibold text-slate-700">Choose a section</p>
                            <div className="mt-3 flex justify-center">
                              <div
                                className="grid gap-3"
                                style={{
                                  gridTemplateColumns:
                                    sections.length === 2
                                      ? 'repeat(2, minmax(220px, 260px))'
                                      : 'repeat(auto-fit, minmax(180px, 220px))',
                                  justifyContent: 'center'
                                }}
                              >
                                {sections.map((section, index) => {
                                  const label = section?.title || `Section ${index + 1}`;
                                  const palette = sectionButtonPalette[index % sectionButtonPalette.length];
                                  return (
                                    <button
                                      key={`section-${index}`}
                                      type="button"
                                      onClick={() => handleStartLesson(index)}
                                      className={`w-full rounded-2xl border px-4 py-2.5 text-base font-semibold shadow-sm transition hover:shadow ${palette}`}
                                    >
                                      {label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-700">
                          <PlayCircle className="h-5 w-5 text-emerald-600" />
                          <span className="font-semibold">Learner:</span>
                          <span className="font-medium text-slate-900">{resolveLearnerName() || 'Not selected yet'}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                    {activePanel === 'explanation' && (
                      <div className="flex min-h-full flex-1 flex-col space-y-4">
                    <div className="mx-auto w-full max-w-[66%] space-y-4">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-bold text-slate-700">
                          {audience === 'kids' ? `${kidTone.label} lesson` : 'Standard lesson'}
                        </p>
                        <span className="text-[11px] font-semibold text-slate-500">{level}</span>
                      </div>
                      {definitionText && (
                        (() => {
                          const defDirection = getDirectionFromFirstWord(definitionText);
                          return (
                            <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                              <p className="text-[11px] font-semibold uppercase text-slate-500">Definition</p>
                              <div className={`mt-2 text-base text-slate-800 ${defDirection.align}`} dir={defDirection.dir}>
                                <span dangerouslySetInnerHTML={renderRichText(definitionText)} />
                              </div>
                            </div>
                          );
                        })()
                      )}
                      {hasBlocks ? (
                        explanationBlocks.map((block) => {
                          const stylePreset = {
                            sky: { card: 'border-sky-200 bg-sky-50/90', pill: 'bg-sky-100 text-sky-700' },
                            amber: { card: 'border-amber-200 bg-amber-50/90', pill: 'bg-amber-100 text-amber-800' },
                            emerald: { card: 'border-emerald-200 bg-emerald-50/90', pill: 'bg-emerald-100 text-emerald-700' },
                            rose: { card: 'border-rose-200 bg-rose-50/90', pill: 'bg-rose-100 text-rose-700' },
                            indigo: { card: 'border-indigo-200 bg-indigo-50/90', pill: 'bg-indigo-100 text-indigo-700' },
                            slate: { card: 'border-slate-200 bg-slate-50/90', pill: 'bg-slate-200 text-slate-700' }
                          }[block.style] || { card: 'border-slate-200 bg-slate-50/90', pill: 'bg-slate-200 text-slate-700' };
                          const blockDirection = getDirectionFromFirstWord(block?.content || '');
                          return (
                            <div key={block.id}>
                              <div className={`relative rounded-2xl border p-4 pt-6 ${stylePreset.card}`}>
                                <div className="absolute left-4 top-0 -translate-y-1/2">
                                  <span className={`rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold ${stylePreset.pill}`}>
                                    {block.title || 'Explanation'}
                                  </span>
                                </div>
                                <div className={`text-base text-slate-800 ${blockDirection.align}`} dir={blockDirection.dir}>
                                  <span dangerouslySetInnerHTML={renderRichText(block?.content || '—')} />
                                </div>
                              </div>
                              {block?.mediaUrl && (
                                <div className="mt-3 flex justify-center">
                                  <div className="inline-block max-w-full overflow-hidden rounded-xl border border-slate-200 bg-transparent p-0 leading-none">
                                    <img
                                      src={block.mediaUrl}
                                      alt="Explanation media"
                                      className="block h-auto max-h-80 w-auto max-w-full object-contain"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        explanationParts.map((part, idx) => (
                          <div key={`explanation-part-${idx}`}>
                            {(() => {
                              const partDirection = getDirectionFromFirstWord(part?.text || '');
                              return (
                            <div className={`rounded-2xl border bg-slate-50/90 p-4 ${explanationBorder}`}>
                              <div className={`text-base text-slate-800 ${partDirection.align}`} dir={partDirection.dir}>
                                {audience === 'kids' && idx === 0 ? <span>{`${kidTone.tone} will love this:`} </span> : null}
                                <span dangerouslySetInnerHTML={renderRichText(part?.text || '—')} />
                              </div>
                            </div>
                              );
                            })()}
                            {part?.mediaUrl && (
                              <div className="mt-3 flex justify-center">
                                <div className="inline-block max-w-full overflow-hidden rounded-xl border border-slate-200 bg-transparent p-0 leading-none">
                                  <img
                                    src={part.mediaUrl}
                                    alt="Explanation media"
                                    className="block h-auto max-h-80 w-auto max-w-full object-contain"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {notes.length > 0 && (
                      <div className="mx-auto w-full max-w-[50%]">
                        <div className="mb-2 flex items-center gap-2">
                          <FileText className="h-4 w-4 text-slate-600" />
                          <p className="rounded-full bg-amber-100/80 px-3 py-0.5 text-sm font-bold text-amber-800">Notes</p>
                        </div>
                        <div className={`rounded-2xl border bg-amber-50/60 p-4 shadow-sm ${noteBorder}`}>
                          <div className={`space-y-2 text-sm text-slate-700 ${noteDirection.align}`} dir={noteDirection.dir}>
                            {notes.length === 1 ? (
                              <div dangerouslySetInnerHTML={renderRichText(notes[0])} />
                            ) : (
                              notes.map((note, idx) => (
                                <div key={`note-${idx}`} className="flex gap-2">
                                  <span className="font-semibold text-slate-500">{idx + 1}.</span>
                                  <div dangerouslySetInnerHTML={renderRichText(note)} />
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    </div>
                  )}

                  {activePanel === 'examples' && (
                    <div className="flex min-h-full flex-1 flex-col space-y-3">
                      <div className="max-h-[58vh] overflow-y-auto pr-1 space-y-3">
                        {renderExamplesInline(visibleExamples)}
                      </div>
                      {canShowMoreExamples && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setVisibleExamplesCount((prev) => Math.min(prev + EXAMPLES_STEP, examples.length))}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                          >
                            <Sparkles className="h-4 w-4" />
                            Show more examples
                          </button>
                          <button
                            type="button"
                            onClick={() => setVisibleExamplesCount(examples.length)}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                          >
                            Expand all
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {activePanel === 'questions' && (
                    <div className="flex min-h-full flex-1 flex-col space-y-4">
                    {currentQuestion ? (
                      <div className="rounded-2xl border border-rose-200 bg-slate-50/90 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase text-slate-500">Question {questionIndex + 1} of {questions.length}</p>
                          {isTest && (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                              Score: {earnedPoints}/{totalPoints}
                            </span>
                          )}
                          <span
                            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-all ${
                              isCorrect || teacherMark === 'correct'
                                ? 'border-emerald-200 bg-emerald-100 text-emerald-800 shadow-sm animate-pulse'
                                : isWrong || teacherMark === 'incorrect'
                                  ? 'border-rose-200 bg-rose-100 text-rose-800 shadow-sm animate-pulse'
                                  : 'border-slate-200 bg-slate-100 text-slate-600'
                            }`}
                          >
                            {isCorrect || teacherMark === 'correct'
                              ? 'Correct ✓'
                              : isWrong || teacherMark === 'incorrect'
                                ? 'Try again ✕'
                                : 'Answer'}
                          </span>
                        </div>
                        <div className="mt-3 text-lg font-semibold text-slate-900 leading-relaxed" dir={questionIsArabic ? 'rtl' : 'ltr'}>
                          <span dangerouslySetInnerHTML={renderRichText(currentQuestion.prompt || 'Question')} />
                        </div>
                        {currentQuestion.mediaUrl && (
                          <div className="mt-3 flex justify-center">
                            <div className="inline-block max-w-[70%] overflow-hidden rounded-xl border border-slate-200 bg-transparent p-0 leading-none">
                              <img
                                src={currentQuestion.mediaUrl}
                                alt="Question media"
                                className="block h-auto max-h-80 w-auto max-w-full object-contain"
                              />
                            </div>
                          </div>
                        )}
                        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-3">
                          {questionOptions.length > 0 ? (
                            questionOptions.map((option, idx) => (
                              <div key={`option-${idx}`} className="relative pt-3">
                                <span
                                  className={`absolute -top-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-xs font-bold text-slate-700 ${questionIsArabic ? 'right-2' : 'left-2'}`}
                                >
                                  {idx + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setAnswers((prev) => ({ ...prev, [answerKey]: idx }))}
                                  className={`w-fit max-w-full rounded-xl border px-5 py-3 text-center text-base font-semibold leading-relaxed ${
                                    selectedIndex === idx
                                      ? idx === correctIndex
                                        ? 'border-emerald-300 bg-slate-50 text-emerald-800'
                                        : 'border-rose-300 bg-slate-50 text-rose-800'
                                      : `bg-slate-50 text-slate-800 hover:bg-slate-100 ${exampleBorderPalette[idx % exampleBorderPalette.length]}`
                                  }`}
                                >
                                  <span dir={questionIsArabic ? 'rtl' : 'ltr'} dangerouslySetInnerHTML={renderRichText(option)} />
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setTeacherMarks((prev) => ({ ...prev, [answerKey]: 'correct' }))}
                                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"
                              >
                                Mark correct
                              </button>
                              <button
                                type="button"
                                onClick={() => setTeacherMarks((prev) => ({ ...prev, [answerKey]: 'incorrect' }))}
                                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                              >
                                Mark incorrect
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                          <button type="button" onClick={() => setQuestionIndex(0)} className="rounded-full border border-slate-200 px-3 py-2 text-slate-600">First</button>
                          <button type="button" onClick={() => setQuestionIndex((prev) => Math.max(0, prev - 1))} className="rounded-full border border-slate-200 px-3 py-2 text-slate-600">Prev</button>
                          <button type="button" onClick={() => setQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1))} className="rounded-full border border-slate-200 px-3 py-2 text-slate-600">Next</button>
                          <button type="button" onClick={() => setQuestionIndex(questions.length - 1)} className="rounded-full border border-slate-200 px-3 py-2 text-slate-600">Last</button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No questions available.</div>
                    )}
                    </div>
                  )}

                  {activePanel === 'objective' && showObjective && (
                    <div className="flex flex-1 justify-center items-start">
                      <div className="w-full max-w-[60%] space-y-3">
                        {objectiveList.map((item, idx) => (
                          <div
                            key={`objective-${idx}`}
                            className="rounded-2xl border border-amber-300 bg-slate-50/90 p-4 text-sm text-slate-700"
                          >
                            <div className="flex gap-2">
                              <span className="font-semibold text-amber-700">{idx + 1}.</span>
                              <span className="flex-1" dangerouslySetInnerHTML={renderRichText(item)} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activePanel === 'board' && (
                    <div className="flex h-full min-h-0 flex-1">
                      <div className="flex h-full min-h-0 flex-1">
                        <WhiteboardModal open inline compact />
                      </div>
                    </div>
                  )}
                  </>
                  )}
                </div>
              </div>
            </div>
          </div>

              <aside className="flex w-16 shrink-0 flex-col items-center gap-3 rounded-3xl bg-white/60 px-2 py-3 text-slate-600 shadow-sm">
                <button
                  type="button"
                  onClick={handleGoHome}
                  className={`flex flex-col items-center gap-1 rounded-2xl border border-slate-200 px-2.5 py-2.5 text-xs font-semibold ${
                    showWelcome ? 'border-[#2C736C]/60 bg-[#2C736C] text-white shadow-lg' : 'hover:bg-white'
                  }`}
                >
                  <Home className="h-5 w-5" />
                  <span className="text-[10px]">Home</span>
                </button>
            <button
              type="button"
              onClick={() => setActivePanel('explanation')}
              className={`flex flex-col items-center gap-1 rounded-2xl border border-indigo-200 px-2.5 py-2.5 text-xs font-semibold ${!showWelcome && activePanel === 'explanation' ? 'bg-indigo-500 text-white shadow-lg' : 'hover:bg-white'}`}
            >
              <Users className="h-5 w-5" />
              <span className="text-[10px]">Lesson</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePanel('examples')}
              className={`flex flex-col items-center gap-1 rounded-2xl border border-emerald-200 px-2.5 py-2.5 text-xs font-semibold ${!showWelcome && activePanel === 'examples' ? 'bg-emerald-500 text-white shadow-lg' : 'hover:bg-white'}`}
            >
              <BookOpen className="h-5 w-5" />
              <span className="text-[10px]">Practice</span>
            </button>
            <button
              type="button"
              onClick={() => setActivePanel('questions')}
              className={`flex flex-col items-center gap-1 rounded-2xl border border-rose-200 px-2.5 py-2.5 text-xs font-semibold ${!showWelcome && activePanel === 'questions' ? 'bg-rose-500 text-white shadow-lg' : 'hover:bg-white'}`}
            >
              <MessageCircle className="h-5 w-5" />
              <span className="text-[10px]">Questions</span>
            </button>
            {showObjective && (
              <button
                type="button"
                onClick={() => setActivePanel('objective')}
                className={`flex flex-col items-center gap-1 rounded-2xl border border-amber-200 px-2.5 py-2.5 text-xs font-semibold ${!showWelcome && activePanel === 'objective' ? 'bg-amber-500 text-white shadow-lg' : 'hover:bg-white'}`}
              >
                <Target className="h-5 w-5" />
                <span className="text-[10px]">Objective</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActivePanel('board')}
              className={`flex flex-col items-center gap-1 rounded-2xl border border-slate-300 px-2.5 py-2.5 text-xs font-semibold ${!showWelcome && activePanel === 'board' ? 'bg-slate-900 text-white shadow-lg' : 'hover:bg-white'}`}
            >
              <PenSquare className="h-5 w-5" />
              <span className="text-[10px]">Board</span>
            </button>
              </aside>
            </div>
          </div>
        </div>
      </div>

      <footer
        className="relative z-30 mt-auto -mx-6 -mb-6 rounded-b-3xl rounded-t-none border-t border-slate-200 bg-white px-6 py-4 text-sm"
        style={{ color: '#000', opacity: 1, filter: 'none', mixBlendMode: 'normal' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-4" style={{ color: '#000', opacity: 1 }}>
          <div className="flex items-center gap-3" style={{ color: '#000', opacity: 1 }}>
            <User className="h-4 w-4" style={{ color: '#000' }} />
            <span className="font-semibold" style={{ color: '#000' }}>Instructor:</span>
            <span className="font-semibold" style={{ color: '#000' }}>{instructorName}</span>
            {learnerName && (
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                Learner: {learnerName}
              </span>
            )}
          </div>
          <div className="font-medium" style={{ color: '#000' }}>
            {hadithText || '“Allah makes the way to Jannah easy for him who treads the path in search of knowledge.”'}
            {!hadithText && (
              <>
                <span className="ml-2" style={{ color: '#000' }}>— Prophet Muhammad ﷺ</span>
                <span className="ml-2" style={{ color: '#000' }}>[Muslim]</span>
              </>
            )}
          </div>
          <div className="text-xs" style={{ color: '#000' }}>Waraqa 2026 copyright</div>
        </div>
      </footer>
    </div>
  );
};

export default LessonStudioViewer;
