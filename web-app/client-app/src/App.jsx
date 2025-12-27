import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './index.css';
import { Radio, Search, Calendar, X, Youtube, Play } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const API_URL = 'http://localhost:3001/api/search';

// Helper: Format nice date
const formatTitle = (item) => {
   // item.date is YYYY-MM-DD
   try {
     const dateObj = parseISO(item.date);
     return `Neil Rogers Show (${format(dateObj, 'MMMM d, yyyy')})`;
   } catch (e) {
     return item.file;
   }
};

const YEARS = [
  '1977', '1982', '1983', '1984', '1985', '1986', '1987', '1988', '1989',
  '1990', '1991', '1992', '1993', '1994', '1995', '1996', '1997', '1998',
  '1999', '2000', '2001', '2002', '2003', '2004', '2005', '2006', '2007', '2008', '2009'
];

function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedYears, setSelectedYears] = useState([]); // Array of strings or empty for ALL
  const [searchTime, setSearchTime] = useState(0);
  
  const [indexStatus, setIndexStatus] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  
  const searchTimeout = useRef(null);

  // Load more function
  const loadMore = async () => {
     if (loading || !hasMore) return;
     
     const currentOffset = results.length;
     const params = { q: query, offset: currentOffset };
     if (selectedYears.length > 0) params.years = selectedYears.join(',');
     
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
    if (!query.trim()) {
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
        if (selectedYears.length > 0) params.years = selectedYears.join(',');

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
           const progress = err.response.data.progress;
           setResults([]); 
           setIndexStatus(`Indexing database... ${progress}% complete`);
           
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
      }
    }, 400); // 400ms delay

    return () => {
        clearTimeout(searchTimeout.current);
        controller.abort();
    };
  }, [query, selectedYears, retryTick]);

  // Helper: Convert HH:MM:SS.ms to seconds
  const tsToSec = (ts) => {
    const parts = ts.split(':').map(parseFloat);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
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
      const tsMatch = line.match(/^\[(\d{2}:\d{2}:\d{2}[.\d]*) -->/);
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

  return (
    <div className="container">
      <header>
        <h1 className="retro-title">
          <Radio style={{display:'inline', marginRight:'10px', verticalAlign:'middle'}} size={32} />
          The Neil Rogers Archive
        </h1>
      </header>
      
      <div className="controls">
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

        <div className="timeline">
          <div 
            className={`timeline-chip ${selectedYears.length === 0 ? 'active' : ''}`}
            onClick={() => setSelectedYears([])}
          >
            ALL YEARS
          </div>
          {YEARS.map(year => (
            <div 
              key={year} 
              className={`timeline-chip ${selectedYears.includes(year) ? 'active' : ''}`}
              onClick={() => {
                 setSelectedYears(prev => {
                    if (prev.includes(year)) {
                       return prev.filter(y => y !== year);
                    } else {
                       return [...prev, year];
                    }
                 });
              }}
            >
              {year}
            </div>
          ))}
        </div>
      </div>

      <main>
        {loading && <div className="loading-indicator">TUNING IN...</div>}

        {indexStatus && (
          <div style={{textAlign:'center', padding:'2rem', color:'var(--accent-color)', fontFamily:'var(--font-mono)'}}>
             <Calendar size={16} style={{display:'inline', marginRight:'8px'}}/>
             {indexStatus}
          </div>
        )}
        
        {!loading && !indexStatus && query && (
          <div style={{marginBottom:'1rem', color:'var(--text-dim)', fontSize:'0.8rem', fontFamily:'var(--font-mono)'}}>
            FOUND {results.length}{hasMore ? '+' : ''} SEGMENTS IN {(searchTime/1000).toFixed(2)}s
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
                    title="Watch on YouTube"
                  >
                    <Youtube size={16} style={{marginRight: '4px'}} />
                    <span style={{fontSize: '0.7rem', fontWeight: 'bold', fontFamily: 'var(--font-mono)'}}>WATCH</span>
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
               NO SIGNAL FOUND. TRY ADJUSTING YOUR FREQUENCY.
             </div>
          )}

          {hasMore && !loading && (
             <button 
               onClick={loadMore}
               style={{
                 width: '100%',
                 padding: '1rem',
                 background: 'var(--panel-bg)',
                 border: '1px dashed var(--accent-color)',
                 color: 'var(--accent-color)',
                 fontFamily: 'var(--font-mono)',
                 cursor: 'pointer',
                 marginTop: '1rem',
                 textTransform: 'uppercase'
               }}
             >
               Load More Transcripts
             </button>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
