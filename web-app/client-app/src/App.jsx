import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './index.css';
import { Radio, Search, Calendar, X, Play, Sun, Moon, List } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const API_URL = '/api/search';

// Helper: Format nice date
const formatTitle = (item) => {
   if (item.type === 'best_of' && item.custom_title) {
     return item.custom_title;
   }
   // item.date is YYYY-MM-DD
   try {
     const dateObj = parseISO(item.date);
     const dateStr = format(dateObj, 'MMMM d, yyyy');
     
     if (item.custom_title) {
       return `${item.custom_title} (${dateStr})`;
     }

     let title = `Neil Rogers Show (${dateStr})`;
     if (item.host) {
       title += ` hosted by ${item.host}`;
     }
     return title;
   } catch (e) {
     return item.file;
   }
};

const YEARS = [
  '1977', '1982', '1983', '1984', '1985', '1986', '1987', '1988', '1989',
  '1990', '1991', '1992', '1993', '1994', '1995', '1996', '1997', '1998',
  '1999', '2000', '2001', '2002', '2003', '2004', '2005', '2006', '2007', '2008', '2009'
];

const YouTubeIcon = ({ size = 16, style = {} }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    style={style}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedYears, setSelectedYears] = useState([]); // Array of strings or empty for ALL
  const [searchTime, setSearchTime] = useState(0);
  
  const [indexStatus, setIndexStatus] = useState('');
  const [totalFiles, setTotalFiles] = useState(-1); // -1 means unknown
  const [retryTick, setRetryTick] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [activeTab, setActiveTab] = useState('search'); // 'search' or 'shows'
  const [showBestOf, setShowBestOf] = useState(false);
  const [allShows, setAllShows] = useState([]);
  const [loadingShows, setLoadingShows] = useState(false);
  
  const searchTimeout = useRef(null);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  // Load more function
  const loadMore = async () => {
     if (loading || !hasMore) return;
     
     const currentOffset = results.length;
     const params = { q: query, offset: currentOffset };
     if (showBestOf) {
       params.type = 'best_of';
     } else if (selectedYears.length > 0) {
       params.years = selectedYears.join(',');
     }
     
     try {
       const res = await axios.get(API_URL, { params });
       if (res.data.length < 100) setHasMore(false);
       setResults(prev => [...prev, ...res.data]);
     } catch (err) {
       console.error("Load more failed", err);
     }
  };

  useEffect(() => {
    // Debounce search
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    // If we're just retrying for status, don't clear results/status immediately
    if (!query.trim() && !showBestOf) { // Added showBestOf condition
      setResults([]);
      setIndexStatus('');
      setHasMore(false);
      return;
    }

    setLoading(true);
    // Don't clear status here if we are retrying, otherwise it flickers. 
    // But how do we know? retryTick changed.
    
    // Create AbortController to cancel previous requests
    const controller = new AbortController();

    searchTimeout.current = setTimeout(async () => {
      const startTime = performance.now();
      try {
        const params = { q: query };
        if (showBestOf) {
          params.type = 'best_of';
        } else if (selectedYears.length > 0) {
          params.years = selectedYears.join(',');
        }

        const res = await axios.get(API_URL, { 
            params,
            signal: controller.signal 
        });
        setResults(res.data);
        setHasMore(res.data.length === 100);
      } catch (err) {
        if (axios.isCancel(err)) {
           console.log('Request canceled');
           return;
        }

        if (err.response && err.response.status === 503) {
           const { progress, totalFiles: count } = err.response.data;
           setResults([]); 
           setTotalFiles(count);
           if (count === 0) {
             setIndexStatus(`Indexing Error: No transcripts found in directory.`);
           } else {
             setIndexStatus(`Indexing database... ${progress}% complete`);
           }
           
           // Retry after 1s
           setTimeout(() => {
             setRetryTick(tick => tick + 1);
           }, 1000);
        } else {
           console.error("Search failed", err);
           setIndexStatus('');
        }
      } finally {
        setLoading(false);
        setSearchTime(performance.now() - startTime);
        // Refresh totalFiles on success if it was unknown
        if (totalFiles === -1) {
           axios.get('/api/status').then(r => setTotalFiles(r.data.totalFiles)).catch(() => {});
        }
      }
    }, 400); // 400ms delay

    return () => {
        clearTimeout(searchTimeout.current);
        controller.abort();
    };
  }, [query, selectedYears, retryTick, showBestOf]); // Added showBestOf

  // Fetch all shows for the "Show List" tab
  useEffect(() => {
    if (activeTab === 'shows') {
      const fetchShows = async () => {
        setLoadingShows(true);
        try {
          const params = {};
          if (showBestOf) {
            params.type = 'best_of';
          } else if (selectedYears.length > 0) {
            params.years = selectedYears.join(',');
          }
          const res = await axios.get('/api/shows', { params });
          setAllShows(res.data);
          setIndexStatus(''); 
          // Get status to know if we have 0 files
          const status = await axios.get('/api/status');
          setTotalFiles(status.data.totalFiles);
        } catch (err) {
          if (err.response && err.response.status === 503) {
             setIndexStatus(`Indexing database... ${err.response.data.progress}% complete`);
             setTotalFiles(err.response.data.totalFiles);
             setTimeout(() => setRetryTick(t => t + 1), 1000);
          } else {
            console.error("Failed to fetch shows", err);
          }
        } finally {
          setLoadingShows(false);
        }
      };
      fetchShows();
    }
  }, [activeTab, selectedYears, showBestOf]);

  // Helper: Convert HH:MM:SS.ms to seconds
  const tsToSec = (ts) => {
    const parts = ts.split(':').map(parseFloat);
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    return parts[0];
  };

  const NEIL_THESAURUS = {
    'jorge': ['jorge', 'george'],
    'george': ['jorge', 'george']
  };

  // Highlighter helper with Deep Linking
  const highlightText = (text, highlight, youtubeUrl) => {
    if (!highlight.trim()) return text;
    const lines = text.split('\n');
    
    // Expand highlight terms using thesaurus
    const originalTerms = highlight.toLowerCase().trim().split(/\s+/);
    const expandedTerms = new Set();
    
    originalTerms.forEach(term => {
      const clean = term.replace(/[^\w]/g, '');
      if (NEIL_THESAURUS[clean]) {
        NEIL_THESAURUS[clean].forEach(t => expandedTerms.add(t));
      } else {
        expandedTerms.add(clean);
      }
    });

    // Create a regex that catches any of our expanded terms
    // We sort by length descending to match longer phrases first if they existed
    const termList = Array.from(expandedTerms).filter(t => t.length > 0);
    if (termList.length === 0) return text;
    
    const highlightRegex = new RegExp(`(${termList.join('|')})`, 'gi');

    return lines.map((line, lineIdx) => {
      const tsMatch = line.match(/^\[(\d{2}:\d{2}:\d{2}[.\d]*) -->/) || line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)/);
      let jumpLink = null;
      
      if (tsMatch && youtubeUrl) {
        const seconds = tsToSec(tsMatch[1]);
        const seekTime = Math.max(0, Math.floor(seconds) - 5);
        const separator = youtubeUrl.includes('?') ? '&' : '?';
        const deepLink = `${youtubeUrl}${separator}t=${seekTime}s`;
        
        jumpLink = (
          <a 
            href={deepLink} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="timestamp-link"
            title={`Jump to ${tsMatch[1]} (with 5s buffer)`}
          >
            <Play size={10} fill="currentColor" style={{marginRight: '4px'}} />
          </a>
        );
      }

      const parts = line.split(highlightRegex);
      return (
        <div key={lineIdx} className="transcript-line">
          {jumpLink}
          {parts.map((part, i) => 
            expandedTerms.has(part.toLowerCase()) ? <span key={i} className="highlight">{part}</span> : part
          )}
        </div>
      );
    });
  };

  const toggleYear = (year) => {
    setSelectedYears(prev => {
      if (prev.includes(year)) {
        return prev.filter(y => y !== year);
      } else {
        return [...prev, year];
      }
    });
  };

  return (
    <div className="container">
      <div className="sticky-header">
        <header style={{position: 'relative'}}>
          <div 
            onClick={toggleTheme} 
            className="theme-toggle"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </div>
          <h1 className="retro-title">
            <Radio style={{display:'inline', marginRight:'10px', verticalAlign:'middle'}} size={32} />
            The Neil Rogers Archive
          </h1>
        </header>
        
        <div className="controls">
          {activeTab === 'search' && (
            <div style={{position: 'relative'}}>
              <input 
                type="text" 
                className="search-bar" 
                placeholder="Search transcripts (e.g., 'Rick and Suds', 'Al Goldstein')..." 
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
              {query ? (
                 <X 
                   onClick={() => setQuery('')}
                   style={{
                     position:'absolute', 
                     right:'15px', 
                     top:'15px', 
                     color:'var(--text-dim)', 
                     cursor: 'pointer'
                   }} 
                 />
              ) : (
                 <Search style={{position:'absolute', right:'15px', top:'15px', color:'var(--text-dim)'}} />
              )}
            </div>
          )}
  
          <div className="timeline">
            <div 
              className={`timeline-chip ${selectedYears.length === 0 && !showBestOf ? 'active' : ''}`}
              onClick={() => {
                setSelectedYears([]);
                setShowBestOf(false);
              }}
            >
              ALL YEARS
            </div>
            <div 
              className={`timeline-chip ${showBestOf ? 'active' : ''}`}
              onClick={() => {
                setShowBestOf(!showBestOf);
                if (!showBestOf) setSelectedYears([]);
              }}
            >
              BEST OF
            </div>
            {YEARS.map(year => (
              <div 
                key={year} 
                className={`timeline-chip ${selectedYears.includes(year) ? 'active' : ''}`}
                onClick={() => {
                  toggleYear(year);
                  setShowBestOf(false);
                }}
              >
                {year}
              </div>
            ))}
          </div>
        </div>

        <div className="tabs">
          <button 
            className={`tab-button ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            <Search size={18} style={{marginRight: '8px'}} /> SEARCH
          </button>
          <button 
            className={`tab-button ${activeTab === 'shows' ? 'active' : ''}`}
            onClick={() => setActiveTab('shows')}
          >
            <List size={18} style={{marginRight: '8px'}} /> SHOW LIST
          </button>
        </div>
        
        {activeTab === 'search' && !loading && !indexStatus && query && (
          <div style={{
            textAlign: 'center', 
            marginBottom: '0.5rem', 
            color: 'var(--text-dim)', 
            fontSize: '0.75rem', 
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase'
          }}>
            FOUND {results.length}{hasMore ? '+' : ''} SEGMENTS IN {(searchTime/1000).toFixed(2)}s
          </div>
        )}

        {activeTab === 'shows' && !loadingShows && (
          <div style={{
            textAlign: 'center', 
            marginBottom: '0.5rem', 
            color: 'var(--text-dim)', 
            fontSize: '0.75rem', 
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase'
          }}>
            LISTING {allShows.length} SHOWS
          </div>
        )}

      </div>

      <main>
        {activeTab === 'search' ? (
          <>
            {loading && <div className="loading-indicator">TUNING IN...</div>}

            {indexStatus && (
              <div style={{textAlign:'center', padding:'2rem', color:'var(--accent-color)', fontFamily:'var(--font-mono)'}}>
                 <Calendar size={16} style={{display:'inline', marginRight:'8px'}}/>
                 {indexStatus}
              </div>
            )}

            <div className="results-grid">
              {results.map((item) => (
                <div key={item.id} className="result-card">
                  <div className="result-header">
                    <span className="result-date">
                      <Radio size={14} style={{display:'inline', marginRight:'5px'}}/>
                      {formatTitle(item)}
                    </span>
                    {item.youtube_url && (
                      <a 
                        href={item.youtube_url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="youtube-link"
                        title="Play on YouTube"
                      >
                        <YouTubeIcon size={16} style={{marginRight: '4px'}} />
                        <span style={{fontSize: '0.7rem', fontWeight: 'bold', fontFamily: 'var(--font-mono)'}}>PLAY</span>
                      </a>
                    )}
                  </div>
                  <div className="result-content">
                    {highlightText(item.snippet || item.text || "", query, item.youtube_url)}
                  </div>
                </div>
              ))}
              
              {!loading && query && results.length === 0 && (
                 <div style={{textAlign:'center', padding:'2rem', color:'var(--text-dim)'}}>
                   NO RESULTS FOUND
                 </div>
              )}

              {hasMore && !loading && (
                 <button 
                   onClick={loadMore}
                   className="load-more-btn"
                 >
                   Load More Transcripts
                 </button>
              )}
            </div>
          </>
        ) : (
          <div className="show-list">
            {indexStatus && (
              <div style={{textAlign:'center', padding:'2rem', color:'var(--accent-color)', fontFamily:'var(--font-mono)'}}>
                 <Calendar size={16} style={{display:'inline', marginRight:'8px'}}/>
                 {indexStatus}
              </div>
            )}

            {loadingShows ? (
              <div className="loading-indicator">GATHERING LOGS...</div>
            ) : (
              <div className="shows-grid">
                {allShows.map((show, idx) => (
                  <div key={idx} className="show-item">
                    <div className="show-item-info">
                      <Radio size={14} className="show-icon" />
                      <span className="show-item-title">{formatTitle(show)}</span>
                    </div>
                    {show.youtube_url && (
                      <a 
                        href={show.youtube_url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="youtube-link"
                        title="Play on YouTube"
                      >
                        <YouTubeIcon size={16} style={{marginRight: '4px'}} />
                        <span style={{fontSize: '0.7rem'}}>PLAY</span>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

    </div>
  );
}

export default App;
