/**
 * Search Service
 * 
 * Provides grep, glob, and readSection utilities for searching
 * reference documentation. Used by the AI chat to look up app
 * knowledge on demand rather than loading everything into context.
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

/**
 * Find files matching a glob-like pattern in a directory.
 * Supports * (any chars) and ** (recursive) patterns.
 */
export function globFiles(pattern: string, dir: string = DATA_DIR): string[] {
  const results: string[] = [];
  
  // Convert glob pattern to regex
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<DOUBLESTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<DOUBLESTAR>>/g, '.*');
  const regex = new RegExp(`^${regexStr}$`);
  
  function walk(currentDir: string, relativePath: string = '') {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(currentDir, entry.name), relPath);
        } else if (regex.test(relPath)) {
          results.push(path.join(currentDir, entry.name));
        }
      }
    } catch (e) {
      // Directory doesn't exist or not readable
    }
  }
  
  walk(dir);
  return results;
}

/**
 * Search file contents by regex pattern. Returns matching lines
 * with line numbers, similar to ripgrep output.
 */
export function grepFile(pattern: string | RegExp, filePath: string): { line: number; text: string }[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    const lines = content.split('\n');
    const matches: { line: number; text: string }[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        matches.push({ line: i + 1, text: lines[i] });
      }
    }
    
    return matches;
  } catch (e) {
    return [];
  }
}

/**
 * Read a markdown section by its header. Returns all content from
 * the matched ## header until the next ## header (or end of file).
 * Case-insensitive matching.
 */
export function readSection(filePath: string, sectionName: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const searchLower = sectionName.toLowerCase();
    
    let capturing = false;
    let capturedLines: string[] = [];
    let headerLevel = 0;
    
    for (const line of lines) {
      // Check if this line is a markdown header
      const headerMatch = line.match(/^(#{1,6})\s+(.+)/);
      
      if (headerMatch) {
        const level = headerMatch[1].length;
        const title = headerMatch[2].toLowerCase().trim();
        
        if (capturing) {
          // Stop if we hit a header at the same or higher level
          if (level <= headerLevel) break;
        }
        
        if (title.includes(searchLower)) {
          capturing = true;
          headerLevel = level;
          capturedLines.push(line);
          continue;
        }
      }
      
      if (capturing) {
        capturedLines.push(line);
      }
    }
    
    return capturedLines.length > 0 ? capturedLines.join('\n').trim() : null;
  } catch (e) {
    return null;
  }
}

/**
 * Search the app reference for content relevant to a user's question.
 * Returns the matching section(s) or null if nothing relevant found.
 * 
 * This is the main function used by visionService to enrich AI prompts.
 */
export function searchAppReference(query: string): string | null {
  const refPath = path.join(DATA_DIR, 'app-reference.md');
  
  if (!fs.existsSync(refPath)) {
    return null;
  }
  
  const queryLower = query.toLowerCase();
  
  // Map of keywords to section names in app-reference.md
  const keywordSections: Record<string, string[]> = {
    // Account settings
    'account size': ['Account Size'],
    'available balance': ['Available Balance'],
    'daily loss limit': ['Daily Loss Limit'],
    'daily loss': ['Daily Loss Limit'],
    'max open position': ['Max Open Positions'],
    'open position': ['Max Open Positions'],
    
    // Instrument types
    'stock': ['Stock / ETF'],
    'etf': ['Stock / ETF'],
    'futures': ['Futures'],
    'margin per contract': ['Margin per Contract'],
    'margin': ['Margin per Contract'],
    'point value': ['Point Value'],
    'multiplier': ['Point Value'],
    'tick size': ['Tick Size'],
    'tick': ['Tick Size'],
    'option': ['Options'],
    'premium': ['Option Price'],
    'option price': ['Option Price'],
    'option type': ['Option Type'],
    'call': ['Option Type'],
    'put': ['Option Type'],
    'contract multiplier': ['Contract Multiplier'],
    'forex': ['Forex'],
    'lot size': ['Lot Size'],
    'pip value': ['Pip Value'],
    'pip': ['Pip Value'],
    'leverage': ['Leverage'],
    'crypto': ['Crypto'],
    'exchange fee': ['Exchange Fee'],
    'micro contract': ['Micro vs Full-Size Contracts', 'Micro Index Futures'],
    'micro future': ['Micro vs Full-Size Contracts', 'Micro Index Futures'],
    'mes': ['Micro Index Futures'],
    'mnq': ['Micro Index Futures'],
    'mym': ['Micro Index Futures'],
    'mgc': ['Micro Commodity Futures'],
    'mcl': ['Micro Commodity Futures'],
    'mbt': ['Micro Crypto Futures'],
    'contract spec': ['Contract Specs Database'],
    
    // Trading concepts
    'energy': ['Energy Indicator'],
    'velocity': ['Energy Indicator'],
    'acceleration': ['Energy Indicator'],
    'exhausted': ['Energy Indicator'],
    'expanding': ['Energy Indicator'],
    'compressing': ['Energy Indicator'],
    'recovering': ['Energy Indicator'],
    'energy state': ['Energy Indicator'],
    'energy score': ['Energy Indicator'],
    'selling pressure': ['Selling Pressure'],
    'pressure': ['Selling Pressure'],
    'seller': ['Selling Pressure'],
    'retracement': ['Retracement'],
    'pullback': ['Retracement', 'Discount Zone'],
    'discount zone': ['Discount Zone'],
    'discount': ['Discount Zone'],
    'fibonacci': ['Fibonacci Levels'],
    'fib level': ['Fibonacci Levels'],
    'fib': ['Fibonacci Levels'],
    'golden ratio': ['Fibonacci Levels'],
    'swing point': ['Swing Points'],
    'swing high': ['Swing Points'],
    'swing low': ['Swing Points'],
    'swing': ['Swing Points'],
    'rdp': ['Swing Points'],
    'ramer': ['Swing Points'],
    'swing sensitivity': ['Swing Sensitivity Slider', 'Swing Points'],
    'wyckoff': ['Wyckoff Method'],
    'accumulation': ['Wyckoff Method'],
    'markup': ['Wyckoff Method'],
    'markdown': ['Wyckoff Method'],
    'breakout': ['Wyckoff Method'],
    'base': ['Wyckoff Method'],
    'trend': ['Trend Analysis'],
    'primary trend': ['Trend Analysis'],
    'intermediate trend': ['Trend Analysis'],
    'trend alignment': ['Trend Analysis'],
    'aligned': ['Trend Analysis'],
    'conflicting': ['Trend Analysis'],
    'go no go': ['Go / No-Go Verdict'],
    'no go': ['Go / No-Go Verdict'],
    'go reason': ['Go / No-Go Verdict'],
    'no-go reason': ['Go / No-Go Verdict'],
    
    // P&L Calculator
    'p&l': ['How P&L Works', 'Live P&L Panel'],
    'pnl': ['How P&L Works', 'Live P&L Panel'],
    'profit': ['How P&L Works'],
    'loss': ['How P&L Works'],
    'profit and loss': ['How P&L Works'],
    'live p&l': ['Live P&L Panel'],
    'unrealized': ['Live P&L Panel'],
    'trade direction': ['Trade Direction'],
    'long': ['Trade Direction'],
    'short': ['Trade Direction'],
    'long short': ['Trade Direction'],
    
    // Position sizing
    'position size': ['How Position Sizing Works', 'Minimum Contract Rule'],
    'position sizing': ['How Position Sizing Works', 'Minimum Contract Rule'],
    'minimum contract': ['Minimum Contract Rule'],
    'zero contract': ['Minimum Contract Rule'],
    '0 contract': ['Minimum Contract Rule'],
    
    // Risk rules
    'risk per trade': ['Risk per Trade'],
    'risk percent': ['Risk per Trade'],
    'min r:r': ['Min R:R Ratio'],
    'r:r': ['Min R:R Ratio'],
    'risk reward': ['Min R:R Ratio'],
    'reward': ['Min R:R Ratio'],
    'risk to reward': ['Min R:R Ratio'],
    'max position size': ['Max Position Size'],
    'max daily trade': ['Max Daily Trades'],
    'daily trade': ['Max Daily Trades'],
    'overtrading': ['Max Daily Trades'],
    'consecutive loss': ['Consecutive Loss Limit'],
    'losing streak': ['Consecutive Loss Limit'],
    'circuit breaker': ['Max Drawdown', 'Consecutive Loss Limit'],
    'max drawdown': ['Max Drawdown'],
    'drawdown': ['Max Drawdown'],
    'require ai': ['Require AI Approval'],
    
    // Verdict engine
    'verdict': ['Verdict Engine'],
    'layer 1': ['Layer 1: Account Constraints'],
    'layer 2': ['Layer 2: Instrument Rules'],
    'layer 3': ['Layer 3: Risk Management'],
    'layer 4': ['Layer 4: Setup Quality'],
    'account constraint': ['Layer 1: Account Constraints'],
    'instrument rule': ['Layer 2: Instrument Rules'],
    'risk management': ['Layer 3: Risk Management'],
    'setup quality': ['Layer 4: Setup Quality'],
    'approved': ['Verdict Engine'],
    'denied': ['Verdict Engine'],
    
    // Chart controls & features
    'entry': ['Set Entry'],
    'stop loss': ['Set Stop Loss'],
    'take profit': ['Set Take Profit'],
    'clear': ['Clear'],
    'calculate': ['Calculate'],
    'screenshot': ['Chart Screenshot'],
    'camera': ['Chart Screenshot'],
    'photo': ['Chart Screenshot'],
    'timeframe': ['Timeframes'],
    'daily chart': ['Timeframes'],
    'weekly chart': ['Timeframes'],
    'hourly chart': ['Timeframes'],
    'intraday': ['Timeframes'],
    'drawing': ['Drawing Tools'],
    'drag': ['Drawing Tools'],
    
    // Trading Desk Analysis
    'analyze': ['Analyze Button', 'Analysis Output Fields'],
    'analysis': ['Analyze Button', 'Analysis Output Fields'],
    'copilot analysis': ['Analysis Output Fields'],
    
    // AI settings
    'ai provider': ['AI Provider'],
    'openai': ['AI Provider'],
    'ollama': ['AI Provider'],
    'model': ['Model'],
    'temperature': ['Temperature'],
    'gpt': ['Model'],
    'chat': ['How the Chat Works', 'What You Can Ask'],
    'ask': ['What You Can Ask'],
    
    // Navigation & pages
    'pattern detector': ['Pattern Detector'],
    'scanner': ['Pattern Detector', 'Discount Zone Scanner'],
    'trade history': ['Trade History'],
    'trading desk': ['Trading Co-Pilot'],
    'position book': ['Trade History'],
    'co-pilot': ['Trading Co-Pilot'],
    'copilot': ['Trading Co-Pilot'],
    'save trade': ['Saving a Trade'],
    'closeout': ['Closeout'],
    'close trade': ['Closeout'],
    'statistics': ['Statistics'],
    'win rate': ['Statistics'],
    'stat': ['Statistics'],
    
    // Scanner
    'discount zone scanner': ['Discount Zone Scanner'],
    'scan mode': ['Scan Modes'],
    'batch scan': ['Discount Zone Scanner'],
    'small cap': ['Discount Zone Scanner'],
    
    // Buttons reference
    'button': ['Buttons and Controls Reference'],
    'control': ['Buttons and Controls Reference'],
    'setting': ['Sidebar Settings'],
    'sidebar': ['Sidebar Settings'],

    // Indicator Studio (Builder/Scanner/Library)
    'indicator studio': ['Indicator Studio', 'Indicator Studio: Builder'],
    'plugin engineer': ['Indicator Studio: Plugin Engineer Chat'],
    'pattern name': ['Pattern Name', 'Blockly Composer: Pattern Name'],
    'pattern id': ['Pattern ID', 'Blockly Composer: Pattern ID'],
    'artifact type': ['Artifact Type'],
    'artifact': ['Artifact Type'],
    'composition': ['Composition', 'Blockly Composer'],
    'primitive': ['Composition'],
    'composite': ['Composition', 'Blockly Composer'],
    'category': ['Category'],
    'save draft': ['Save Draft'],
    'start blank': ['Start Blank'],
    'register plugin': ['Register Plugin'],
    'test output': ['Test Output'],
    'pattern definition': ['Pattern Definition (JSON)'],
    'builder': ['Indicator Studio: Builder'],
    'pattern scanner': ['Indicator Studio: Pattern Scanner'],
    'indicator library': ['Indicator Studio: Indicator Library'],
    'load to builder': ['Load to Builder'],
    'browse existing': ['Browse Existing'],
    'new plugin': ['New Plugin'],

    // Strategy + Validator
    'edit strategy': ['Edit Strategy'],
    'strategy details': ['Strategy Details Page'],
    'run validation': ['Run Validation'],
    'validation tier': ['Validation Tier'],
    'tier 1': ['Tier 1 - Kill Test'],
    'tier 2': ['Tier 2 - Core Validation'],
    'tier 3': ['Tier 3 - Robustness'],
    'asset class': ['Asset Class'],
    'start date': ['Start Date / End Date'],
    'end date': ['Start Date / End Date'],
    'validator': ['Validator Reports Page'],
    'symbol library': ['Validator Symbol Library Page'],

    // Scanner pages
    'training data': ['Training Data Page'],
    'saved symbols': ['Saved Symbols Page'],
    'scanner settings': ['Scanner Settings Page'],
    'cancel scan': ['Cancel Scan'],
    'next chart': ['Forward / Back Buttons'],
    'previous chart': ['Forward / Back Buttons'],

    // Blockly Composer
    'blockly': ['Blockly Composer'],
    'composer': ['Blockly Composer'],
    'compose': ['Blockly Composer', 'Blockly Composer: Compose Indicator Block'],
    'blockly composition': ['Blockly Composer', 'Blockly Composer: Compose Indicator Block'],
    'compose indicator': ['Blockly Composer: Compose Indicator Block'],
    'reducer': ['Blockly Composer: Reducer'],
    'and or': ['Blockly Composer: Reducer'],
    'n of m': ['Blockly Composer: Reducer', 'Blockly Composer: N Value'],
    'n-of-m': ['Blockly Composer: Reducer', 'Blockly Composer: N Value'],
    'structure socket': ['Blockly Composer: Structure Socket'],
    'location socket': ['Blockly Composer: Location Socket'],
    'timing socket': ['Blockly Composer: Timing Trigger Socket'],
    'trigger socket': ['Blockly Composer: Timing Trigger Socket'],
    'pattern gate': ['Blockly Composer: Regime Filter Socket'],
    'regime filter': ['Blockly Composer: Regime Filter Socket'],
    'typed socket': ['Blockly Composer: Structure Socket', 'Blockly Composer: Location Socket', 'Blockly Composer: Timing Trigger Socket', 'Blockly Composer: Regime Filter Socket'],
    'toolbox': ['Blockly Composer: Toolbox'],
    'send to builder': ['Blockly Composer: Send to Builder Button'],
    'copy json': ['Blockly Composer: Copy JSON Button'],
    'validate button': ['Blockly Composer: Validate Button'],
    'validate composition': ['Blockly Composer: Validate Button'],
    'blockly validate': ['Blockly Composer: Validate Button'],
    'copy json button': ['Blockly Composer: Copy JSON Button'],
    'send to builder button': ['Blockly Composer: Send to Builder Button'],
    'blockly intent': ['Blockly Composer: Intent'],
    'entry exit': ['Blockly Composer: Intent'],
    'blockly assistant': ['Blockly Composer: Blockly Assistant'],
    'composite definition': ['Blockly Composer: Composite Definition JSON'],
    'blockly json': ['Blockly Composer: Composite Definition JSON'],
    'status badge': ['Blockly Composer: Status'],
    'experimental': ['Blockly Composer: Status', 'Status'],
  };
  
  // Find matching sections
  const matchedSections = new Set<string>();
  
  for (const [keyword, sections] of Object.entries(keywordSections)) {
    if (queryLower.includes(keyword)) {
      sections.forEach(s => matchedSections.add(s));
    }
  }
  
  if (matchedSections.size === 0) {
    // Fallback for unseen help terms: try fuzzy matching against markdown headings.
    // This keeps help usable even when keyword mapping is incomplete.
    const raw = fs.readFileSync(refPath, 'utf-8');
    const headingMatches = Array.from(raw.matchAll(/^(#{2,3})\s+(.+)$/gm)).map((m) => m[2].trim());
    const tokens = queryLower
      .split(/[^a-z0-9]+/g)
      .map((t) => t.trim())
      .filter((t) => t.length >= 4);

    for (const heading of headingMatches) {
      const headingLower = heading.toLowerCase();
      if (tokens.some((t) => headingLower.includes(t))) {
        matchedSections.add(heading);
      }
      if (matchedSections.size >= 3) break;
    }
  }

  if (matchedSections.size === 0) return null;
  
  // Read each matched section
  const results: string[] = [];
  const seen = new Set<string>();
  for (const section of matchedSections) {
    const content = readSection(refPath, section);
    if (content) {
      const key = content.trim();
      if (!seen.has(key)) {
        seen.add(key);
        results.push(key);
      }
    }
  }
  
  return results.length > 0 ? results.join('\n\n') : null;
}
