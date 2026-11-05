import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Check, Clock3, Command, Compass, Download, Globe2, Heart, LockKeyhole, Menu, Minus, PanelLeft, Plus, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import { translate, type Language } from './i18n';
import { REPOSITORY, useLatestRelease, type BrowserRelease } from './useLatestRelease';
import './index.css';

const tabs = ['Home', 'Focus', 'Discover'] as const;
type DemoTab = typeof tabs[number];
const faqs = [
  { question: 'What is soulm8te?', answer: 'A desktop browser built with Electron and Chromium. It combines workspaces, sleeping tabs, private sessions and optional Voodoo AI in one app.' },
  { question: 'Can I bring my bookmarks and passwords?', answer: 'The browser includes import tools and HTML bookmark export. Available data depends on your source browser and whether its password storage can be unlocked.' },
  { question: 'Is soulm8te free?', answer: 'The browser is free to download. There is no Plus plan or early-access signup. Optional AI providers may have their own usage costs.' },
  { question: 'Which systems can I download it for?', answer: 'Published installers currently cover Ubuntu and compatible Debian systems on x86_64. Choose DEB for installation or AppImage for a portable format. Windows and macOS installers are not offered here.' },
  { question: 'How does Voodoo AI work?', answer: 'Voodoo uses an API provider configured in browser settings. Requests and selected page context are sent to that provider. You choose whether to enable and use it.' },
  { question: 'Where can I report a problem?', answer: 'Open an issue in the GitHub repository. Include your browser version, Ubuntu version, the affected page and steps to reproduce. Avoid posting passwords or private browsing data.' },
];

function Brand({ light = false }: { light?: boolean }) {
  return <a href="#top" className={`brand ${light ? 'brand-light' : ''}`} aria-label="soulm8te home"><span className="brand-symbol" aria-hidden="true"><span /></span><span>soulm8te<span className="brand-period">.</span></span></a>;
}

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduceMotion = useReducedMotion();
  return <motion.div className={className} initial={reduceMotion ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.16 }} transition={{ duration: 0.75, delay, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div>;
}

function BrowserDemo({ language }: { language: Language }) {
  const t = (text: string) => translate(text, language);
  const [activeTab, setActiveTab] = useState<DemoTab>('Home');
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState(false);
  function searchWeb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim()) window.open(`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`, '_blank', 'noopener,noreferrer');
  }
  return <div className="browser-window" aria-label={t("Interactive preview of the soulm8te browser")}>
    <div className="browser-topbar"><div className="window-controls" aria-hidden="true"><i /><i /><i /></div><div className="browser-tabs" role="tablist" aria-label={t("Browser preview tabs")}>{tabs.map(tab => <button key={tab} role="tab" aria-selected={activeTab === tab} className={`browser-tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}><span className="tiny-orb" />{t(tab)}</button>)}<Plus size={14} className="tab-plus" aria-hidden="true" /></div><PanelLeft size={16} className="topbar-end" aria-hidden="true" /></div>
    <div className="browser-toolbar"><div className="toolbar-arrows" aria-hidden="true"><ArrowLeft size={16} /><ArrowRight size={16} /></div><div className="browser-address"><LockKeyhole size={13} /><span>browser://newtab</span><Bookmark size={15} className="address-bookmark" /></div><Sparkles size={16} className="toolbar-sparkle" aria-hidden="true" /></div>
    <div className="browser-body"><div className="browser-sidebar" aria-hidden="true"><div className="sidebar-logo"><span className="brand-symbol"><span /></span></div><Compass size={18} className={activeTab === 'Home' ? 'side-active' : ''} /><Bookmark size={17} /><Clock3 size={17} /><div className="sidebar-bottom"><Plus size={18} /></div></div><div className="browser-content"><div className="preview-photo" /><div className="preview-shade" /><div className="preview-inner"><div className="preview-overline">{t("YOUR SPACE, YOUR PACE")}</div><div className="preview-mark"><span className="brand-symbol"><span /></span><span>SOULM8TE</span></div><h3>{activeTab === 'Home' ? t('Make room for what matters.') : activeTab === 'Focus' ? t('Find your flow.') : t('Follow your curiosity.')}</h3><p>{activeTab === 'Home' ? t('A little less noise. A lot more you.') : activeTab === 'Focus' ? t('Just you and the things you came here to do.') : t('The good parts of the internet, all in one place.')}</p><form className="preview-search" onSubmit={searchWeb}><Search size={19} aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search the web")} aria-label={t("Search the web")} /><button type="submit" aria-label={t("Search")}><ArrowRight size={18} /></button></form><div className="preview-lower"><div className="preview-bookmarks"><div className="preview-line-title"><span><Bookmark size={14} /> {t("Your bookmarks")}</span><button onClick={() => setSaved(!saved)} aria-label={t(saved ? 'Remove sample bookmark' : 'Add sample bookmark')}>{saved ? <Check size={15} /> : <Plus size={15} />}</button></div><div className="bookmark-items"><span className="bookmark-icon violet">N</span><span className="bookmark-icon coral">F</span><span className="bookmark-icon blue">G</span>{saved && <span className="bookmark-icon mint">S</span>}</div></div><div className="preview-recent"><div className="preview-line-title"><span><Clock3 size={14} /> {t("Pick up where you left off")}</span></div><div className="recent-item"><span className="recent-dot" /> {t("The little things worth finding")} <ArrowUpRight size={13} /></div><div className="recent-item"><span className="recent-dot second" /> {t("A fresh perspective")} <ArrowUpRight size={13} /></div></div></div></div><div className="preview-caption">{t("a softer place to land")} <span>✳</span></div></div></div>
  </div>;
}


function DownloadLinks({ release, language, light = false }: { release: BrowserRelease; language: Language; light?: boolean }) {
  const t = (text: string) => translate(text, language);
  return <div className={`download-links ${light ? 'download-links-light' : ''}`}>
    {release.deb ? <a className="button download-primary" href={release.deb}><Download size={17} aria-hidden="true" />{t('Download DEB')}<ArrowUpRight size={17} aria-hidden="true" /></a> : <span className="download-unavailable">{t('DEB is not included in this release.')}</span>}
    {release.appImage ? <a className="button download-secondary" href={release.appImage}>{t('Download AppImage')}<ArrowUpRight size={17} aria-hidden="true" /></a> : <span className="download-unavailable">{t('AppImage is not included in this release.')}</span>}
  </div>;
}

function DownloadModal({ release, language, onDismiss }: { release: BrowserRelease; language: Language; onDismiss: () => void }) {
  const isPresent = useIsPresent();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const t = (text: string) => translate(text, language);
  useEffect(() => {
    if (!isPresent) return;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onDismissRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = [...(modalRef.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])].filter(item => item.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => { window.removeEventListener('keydown', keyboard); document.body.style.overflow = previousOverflow; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [isPresent]);
  return <motion.div className="modal-backdrop" style={{ pointerEvents: isPresent ? 'auto' : 'none' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => { if (event.target === event.currentTarget) onDismiss(); }}>
    <motion.div className="access-modal download-modal" ref={modalRef} role="dialog" inert={!isPresent} aria-modal={isPresent ? true : undefined} aria-hidden={!isPresent} aria-labelledby="download-dialog-title" initial={{ opacity: 0, scale: 0.96, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 20 }} transition={{ duration: 0.25 }}>
      <button className="modal-close" ref={closeRef} aria-label={t('Close dialog')} onClick={onDismiss}><X size={21} /></button><div className="modal-symbol"><Download size={32} /></div><p className="section-label">SOULM8TE {release.version}</p><h2 id="download-dialog-title">{t('Download for Ubuntu')}<span>.</span></h2><p>{t('Choose your format. These links download the official release files directly from GitHub.')}</p><DownloadLinks release={release} language={language} /><a className="download-release-link" href={release.releaseUrl}>{t('Release notes')} <ArrowUpRight size={14} /></a><small>Ubuntu / Debian · x86_64 · {t('Free download')}</small>
    </motion.div>
  </motion.div>;
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [language, setLanguage] = useState<Language>(() => {
    try { return window.localStorage.getItem('soulm8te-language') === 'en' ? 'en' : 'ru'; } catch { return 'ru'; }
  });
  const reduceMotion = useReducedMotion();
  const { release, status } = useLatestRelease();
  const t = (text: string) => translate(text, language);
  const navLinks = [['Why soulm8te', '#why'], ['The browser', '#browser'], ['Downloads', '#downloads'], ['FAQ', '#faq']];
  useEffect(() => {
    document.documentElement.lang = language;
    try { window.localStorage.setItem('soulm8te-language', language); } catch { /* Language switching works without storage. */ }
    document.title = language === 'ru' ? 'soulm8te — браузер для Ubuntu' : 'soulm8te — browser for Ubuntu';
    document.querySelector('meta[name=description]')?.setAttribute('content', t('A free Chromium browser for Ubuntu. Download official GitHub releases, explore workspaces, private sessions and Voodoo AI.'));
  }, [language]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);
  function openDownloads() { setMenuOpen(false); setModalOpen(true); }

  return <div id="top" className="site-shell">
    <a href="#main" className="skip-link">{t('Skip to content')}</a>
    <header className="site-header"><div className="nav-wrap"><Brand light /><nav className="desktop-nav" aria-label={t('Main navigation')}>{navLinks.map(([label, href]) => <a href={href} key={label}>{t(label)}</a>)}</nav><div className="nav-actions"><div className="language-switch" role="group" aria-label={t('Choose language')}><button type="button" lang="ru" aria-label="Русский" aria-pressed={language === 'ru'} className={language === 'ru' ? 'active' : ''} onClick={() => setLanguage('ru')}>RU</button><span aria-hidden="true">/</span><button type="button" lang="en" aria-label="English" aria-pressed={language === 'en'} className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button></div><button className="nav-cta" onClick={openDownloads}>{t('Download browser')} <ArrowUpRight size={15} /></button><button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label={t(menuOpen ? 'Close menu' : 'Open menu')} aria-expanded={menuOpen} aria-controls="mobile-navigation">{menuOpen ? <X size={24} /> : <Menu size={24} />}</button></div></div><AnimatePresence>{menuOpen && <motion.nav id="mobile-navigation" className="mobile-nav" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} aria-label={t('Mobile navigation')}>{navLinks.map(([label, href]) => <a href={href} key={label} onClick={() => setMenuOpen(false)}>{t(label)}<ArrowUpRight size={17} /></a>)}<button onClick={openDownloads}>{t('Download browser')} <ArrowRight size={18} /></button></motion.nav>}</AnimatePresence></header>
    <main id="main">
      <section className="hero" aria-labelledby="hero-title"><div className="hero-image" /><div className="hero-vignette" /><div className="hero-content page-width"><motion.div className="hero-copy" initial={reduceMotion ? false : 'hidden'} animate="visible" variants={{ visible: { transition: { staggerChildren: 0.13 } } }}><motion.div className="hero-eyebrow" variants={{ hidden: { opacity: 0, y: 18 }, visible: { opacity: 1, y: 0 } }}><span className="eyebrow-line" /> {t('THE BROWSER THAT FEELS LIKE YOURS')}</motion.div><motion.h1 id="hero-title" variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } }}>soulm8te<span>.</span></motion.h1><motion.h2 variants={{ hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0 } }}>{t('The internet, with')}<br />{t('a little more soul.')}</motion.h2><motion.p variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}>{t('Your tabs, your workspace, your rhythm. A free browser built on Chromium, with useful tools already inside.')}</motion.p><motion.div className="hero-actions" variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}><button className="button button-light" onClick={openDownloads}>{t('Download for Ubuntu')} <ArrowUpRight size={18} /></button><a className="text-link light-link" href="#browser">{t('Explore the browser')} <ArrowRight size={17} /></a></motion.div><p className="hero-release">v{release.version} · Ubuntu x86_64 · {t('Free download')}</p></motion.div></div><a className="hero-scroll" href="#intro"><span className="scroll-track"><span /></span> {t('SCROLL TO EXPLORE')}</a><div className="hero-side-note">{t('A MORE HUMAN WAY ONLINE')} <span>01 / 04</span></div></section>

      <section className="intro section-light" id="intro"><div className="page-width intro-grid"><Reveal><p className="section-label"><span className="label-dot" /> {t('THE WAY FORWARD')}</p></Reveal><Reveal delay={0.12}><h2>{t('Your browser should')}<br />{t('feel like')} <em>{t('your space.')}</em></h2><p className="intro-copy">{t('Keep projects in separate workspaces, pin important pages and let background tabs sleep. Bring your bookmarks along and make the start page your own.')}</p></Reveal></div><div className="page-width intro-bottom"><span>{t('BUILT WITH ELECTRON + CHROMIUM')}</span><a href={REPOSITORY}>{t('OPEN SOURCE ON GITHUB')} <ArrowUpRight size={16} /></a></div></section>

      <section className="web-proof" aria-label={t('Everyday browsing')}><div className="page-width"><Reveal><p>{t('One place for your everyday web.')}</p><div className="web-proof-logos"><span>{t('Workspaces')}</span><span>{t('Bookmarks')}</span><span>{t('Reader mode')}</span><span>Voodoo AI</span></div><small>{t('Website compatibility depends on the site. Chromium-based does not mean every Chrome extension, DRM service or login flow is supported.')}</small></Reveal></div></section>

      <section className="principles" id="why"><div className="page-width"><Reveal className="section-heading"><p className="section-label"><span className="label-dot" /> {t('WHY SOULM8TE')}</p><h2>{t('Useful by design.')}<br /><em>{t('Ready for your day.')}</em></h2><p>{t('Practical browser tools, without a separate extension for every small task.')}</p></Reveal><div className="principle-list"><Reveal className="principle-row"><span className="principle-number">01</span><div className="principle-icon"><Compass size={27} strokeWidth={1.4} /></div><div><h3>{t('Keep your place.')}</h3><p>{t('Workspaces, pinned tabs, tab search and two-page split view help keep projects together.')}</p></div><ArrowUpRight size={21} className="principle-arrow" /></Reveal><Reveal className="principle-row" delay={0.08}><span className="principle-number">02</span><div className="principle-icon"><Sparkles size={27} strokeWidth={1.4} /></div><div><h3>{t('Ask Voodoo.')}</h3><p>{t('An optional AI assistant for page summaries and browser tasks. Configure your provider and API keys in settings.')}</p></div><ArrowUpRight size={21} className="principle-arrow" /></Reveal><Reveal className="principle-row" delay={0.16}><span className="principle-number">03</span><div className="principle-icon"><ShieldCheck size={27} strokeWidth={1.4} /></div><div><h3>{t('Control your session.')}</h3><p>{t('Private sessions, site permissions, ad blocking and Click & Clean put everyday privacy controls within reach.')}</p></div><ArrowUpRight size={21} className="principle-arrow" /></Reveal></div></div></section>

      <section className="showcase" id="browser"><div className="page-width showcase-heading"><Reveal><p className="section-label"><span className="label-dot" /> {t('A CLOSER LOOK')}</p><h2>{t('A new way to feel')}<br /><em>{t('at home online.')}</em></h2><p>{t('A customizable start page, bookmarks and familiar navigation. Explore the interactive design preview below.')}</p></Reveal></div><Reveal className="showcase-stage" delay={0.1}><BrowserDemo language={language} /></Reveal><div className="page-width showcase-foot"><span>{t('INTERACTIVE DESIGN PREVIEW')}</span><span>{t('An illustration of the interface, not a live browser session.')}</span></div></section>

      <section className="benefits"><div className="page-width benefits-grid"><Reveal className="benefits-copy"><p className="section-label"><span className="label-dot" /> {t('THE LITTLE THINGS ADD UP')}</p><h2>{t('More tools.')}<br /><em>{t('Fewer interruptions.')}</em></h2><p>{t('Read an article, save a note, check a page font or pop a video into a floating player. Small tools stay close to the page.')}</p><a className="text-link dark-link" href={`${REPOSITORY}/tree/main/docs`}>{t('Read the documentation')} <ArrowUpRight size={18} /></a></Reveal><div className="benefits-list"><Reveal className="benefit-item"><div className="benefit-mark"><Heart size={21} strokeWidth={1.5} /></div><div><h3>{t('A space of your own')}</h3><p>{t('Choose a theme and wallpaper. Import and export bookmarks, manage downloads and keep quick notes.')}</p></div></Reveal><Reveal className="benefit-item" delay={0.08}><div className="benefit-mark"><Globe2 size={21} strokeWidth={1.5} /></div><div><h3>{t('Tools for the page')}</h3><p>{t('Reader mode, font diagnostics, QR links and copying links without known advertising tags are built in.')}</p></div></Reveal><Reveal className="benefit-item" delay={0.16}><div className="benefit-mark"><Command size={21} strokeWidth={1.5} /></div><div><h3>{t('Stay in control')}</h3><p>{t('Search open tabs, use keyboard shortcuts and inspect browser processes in the task manager.')}</p></div></Reveal></div></div></section>

      <section className="voices" aria-label={t('Available now')}><div className="page-width voices-grid"><Reveal><p className="section-label"><span className="label-dot" /> {t('ALREADY IN THE BROWSER')}</p><h2>{t('Less setup.')}<br />{t('More useful details.')}</h2></Reveal><Reveal className="quote-area capability-list" delay={0.1}><article><h3>{t('Sleeping tabs')}</h3><p>{t('Put inactive tabs to sleep to free resources, then reopen them when needed.')}</p></article><article><h3>Click & Clean</h3><p>{t('Choose what to clear: cache, cookies, history and site storage. Password deletion stays a separate explicit choice.')}</p></article><article><h3>{t('Font diagnostics')}</h3><p>{t('See declared web fonts and their loading status when a page does not look right.')}</p></article></Reveal></div></section>

      <section className="pricing section-light" id="downloads"><div className="page-width"><Reveal className="pricing-heading"><p className="section-label"><span className="label-dot" /> {t('DOWNLOAD SOULM8TE')}</p><h2>{t('Your next browser.')}<br /><em>{t('Ready to download.')}</em></h2><p>{t('Free Ubuntu x86_64 builds. No account and no early-access list.')}</p></Reveal><div className="pricing-topline"><span>{t('VERSION')} {release.version}</span><a className="release-history" href={release.releaseUrl}>{t('Release notes')} <ArrowUpRight size={14} /></a></div><div className="pricing-grid"><Reveal className="plan"><div className="plan-top"><span>{t('01 / INSTALL ON UBUNTU')}</span><h3>DEB</h3><p>{t('Recommended for installation and updating an existing Ubuntu setup.')}</p></div>{release.deb ? <a className="plan-button plan-button-dark" href={release.deb}>{t('Download DEB')} <Download size={17} /></a> : <p>{t('DEB is not included in this release.')}</p>}<div className="plan-features"><span><Check size={17} /> Ubuntu / Debian · amd64</span><span><Check size={17} />{t('Installs with your package manager')}</span><span><Check size={17} />{t('Keeps your existing browser profile on update')}</span></div></Reveal><Reveal className="plan plan-plus" delay={0.1}><div className="plan-top"><span>{t('02 / PORTABLE FORMAT')}</span><h3>AppImage</h3><p>{t('A portable Linux package. FUSE support or AppImage extraction may be needed.')}</p></div>{release.appImage ? <a className="plan-button plan-button-outline" href={release.appImage}>{t('Download AppImage')} <Download size={17} /></a> : <p>{t('AppImage is not included in this release.')}</p>}<div className="plan-features"><span><Check size={17} /> Linux · x86_64</span><span><Check size={17} />{t('One downloadable application file')}</span><span><Check size={17} />{t('Published alongside the DEB build')}</span></div></Reveal></div><div className="download-meta"><p role="status">{t(status === 'loading' ? 'Checking the latest GitHub release…' : status === 'live' ? 'Latest stable release from GitHub.' : 'Showing a stable build. Check GitHub for newer releases.')}</p>{release.checksums && <a href={release.checksums}>SHA256SUMS <ArrowUpRight size={13} /></a>}<a href={`${REPOSITORY}/releases`}>{t('All releases')} <ArrowUpRight size={13} /></a></div>{release.deb && <div className="install-command"><span>{t('Install or update from the folder containing your downloaded DEB:')}</span><code>sudo apt install ./soulm8te-{release.version}-linux-amd64.deb</code></div>}</div></section>

      <section className="faq" id="faq"><div className="page-width faq-grid"><Reveal><p className="section-label"><span className="label-dot" /> {t('GOOD TO KNOW')}</p><h2>{t('A few things')}<br />{t('you might')} <em>{t('wonder.')}</em></h2><p className="faq-aside">{t('Questions, problems or ideas? The project is on GitHub.')}</p><a className="text-link dark-link" href={`${REPOSITORY}/issues`}>{t('Open GitHub issues')} <ArrowUpRight size={17} /></a></Reveal><div className="faq-list">{faqs.map((faq, index) => <Reveal key={faq.question} delay={index * 0.04}><div className={`faq-item ${openFaq === index ? 'open' : ''}`}><button aria-expanded={openFaq === index} aria-controls={`faq-answer-${index}`} onClick={() => setOpenFaq(openFaq === index ? null : index)}><span>{t(faq.question)}</span>{openFaq === index ? <Minus size={19} /> : <Plus size={19} />}</button><AnimatePresence initial={false}>{openFaq === index && <motion.div id={`faq-answer-${index}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="faq-answer"><p>{t(faq.answer)}</p></motion.div>}</AnimatePresence></div></Reveal>)}</div></div></section>

      <section className="final-cta"><div className="cta-orb orb-one" /><div className="cta-orb orb-two" /><div className="page-width final-inner"><Reveal><p className="section-label"><span className="label-dot" /> {t('THE NEXT CHAPTER IS YOURS')}</p><h2>{t('Feel more at home')}<br />{t('on the internet')}<span>.</span></h2><p>{t('Start with the current Ubuntu release. Explore the source and follow future updates on GitHub.')}</p><button className="button button-light" onClick={openDownloads}>{t('Download browser')} <ArrowUpRight size={18} /></button></Reveal><span className="final-decoration" aria-hidden="true"><span className="brand-symbol"><span /></span></span></div></section>
    </main>
    <footer className="footer"><div className="page-width"><div className="footer-main"><div><Brand /><p>{t('For a more human way online.')}</p></div><div className="footer-links"><div><span>{t('EXPLORE')}</span><a href="#why">{t('Why soulm8te')}</a><a href="#browser">{t('The browser')}</a><a href="#downloads">{t('Downloads')}</a></div><div><span>GITHUB</span><a href={REPOSITORY}>{t('Source code')}</a><a href={`${REPOSITORY}/issues`}>{t('Report a problem')}</a><a href={`${REPOSITORY}/releases`}>{t('All releases')}</a></div></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} soulm8te · {t('Free browser for Ubuntu')}</span><a href="#top">{t('Back to top ↑')}</a></div></div></footer>
    <AnimatePresence>{modalOpen && <DownloadModal release={release} language={language} onDismiss={() => setModalOpen(false)} />}</AnimatePresence>
  </div>;
}

export default App;
