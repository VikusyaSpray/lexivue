import fs from 'node:fs';
import path from 'node:path';

// Load local .env / .env.local if present (useful for local `npm run dev` / `npm start` without dotenv)
function loadLocalEnvOnce() {
  if (globalThis.__lexivueEnvLoaded) return;
  globalThis.__lexivueEnvLoaded = true;
  for (const filename of ['.env.local', '.env']) {
    try {
      const fullPath = path.join(process.cwd(), filename);
      if (!fs.existsSync(fullPath)) continue;
      const raw = fs.readFileSync(fullPath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // ignore env file read errors
    }
  }
}

loadLocalEnvOnce();

const translateCache = new Map();
const MAX_CACHE_ENTRIES = 1500;

function setCache(key, value) {
  if (translateCache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = translateCache.keys().next().value;
    if (firstKey !== undefined) translateCache.delete(firstKey);
  }
  translateCache.set(key, value);
}

const POS_UK = {
  noun: 'іменник',
  verb: 'дієслово',
  adjective: 'прикметник',
  adverb: 'прислівник',
  pronoun: 'займенник',
  preposition: 'прийменник',
  conjunction: 'сполучник',
  interjection: 'вигук',
  exclamation: 'вигук',
  article: 'артикль',
  determiner: 'детермінатив',
  abbreviation: 'скорочення',
  auxiliary: 'допоміжне дієслово',
  'auxiliary verb': 'допоміжне дієслово',
  modal: 'модальне дієслово',
  particle: 'частка',
};

// High-frequency English idioms, set expressions & phrasal verbs heard in YouTube videos.
// Used immediately even without an AI API key (and as a backup if AI is unavailable).
const IDIOM_RULES = [
  // Classic idioms & set expressions
  { re: /\b(?:break|breaks|broke|broken|breaking)\s+a\s+leg\b/gi, phrase: 'break a leg', uk: 'ні пуху ні пера (удачі!)', note: 'сталий вираз' },
  { re: /\bat\s+the\s+end\s+of\s+the\s+day\b/gi, phrase: 'at the end of the day', uk: 'зрештою, у підсумку', note: 'сталий вираз' },
  { re: /\b(?:take|takes|took|taken|taking)\s+(?:it|them|this|that|him|her|me|us|you|things|\w+)?\s*for\s+granted\b/gi, phrase: 'take for granted', uk: 'сприймати як належне', note: 'сталий вираз' },
  { re: /\b(?:make|makes|made|making)\s+(?:no\s+|complete\s+|total\s+|perfect\s+|a\s+lot\s+of\s+)?sense\b/gi, phrase: 'make sense', uk: 'мати сенс, бути логічним', note: 'сталий вираз' },
  { re: /\b(?:a\s+)?piece\s+of\s+cake\b/gi, phrase: 'a piece of cake', uk: 'простіше простого, раз плюнути', note: 'сталий вираз' },
  { re: /\bonce\s+in\s+a\s+blue\s+moon\b/gi, phrase: 'once in a blue moon', uk: 'раз на сто років, дуже рідко', note: 'сталий вираз' },
  { re: /\bout\s+of\s+the\s+blue\b/gi, phrase: 'out of the blue', uk: 'ні з того ні з сього, зненацька', note: 'сталий вираз' },
  { re: /\bin\s+the\s+long\s+run\b/gi, phrase: 'in the long run', uk: 'у довгостроковій перспективі, зрештою', note: 'сталий вираз' },
  { re: /\bas\s+a\s+matter\s+of\s+fact\b/gi, phrase: 'as a matter of fact', uk: 'насправді, по суті', note: 'сталий вираз' },
  { re: /\bon\s+the\s+other\s+hand\b/gi, phrase: 'on the other hand', uk: 'з іншого боку', note: 'сталий вираз' },
  { re: /\bby\s+the\s+way\b/gi, phrase: 'by the way', uk: 'до речі', note: 'сталий вираз' },
  { re: /\ball\s+of\s+a\s+sudden\b/gi, phrase: 'all of a sudden', uk: 'раптом, зненацька', note: 'сталий вираз' },
  { re: /\bout\s+of\s+nowhere\b/gi, phrase: 'out of nowhere', uk: 'нізвідки, раптово', note: 'сталий вираз' },
  { re: /\bunder\s+the\s+weather\b/gi, phrase: 'under the weather', uk: 'нездужати, погано почуватися', note: 'сталий вираз' },
  { re: /\b(?:cost|costs|costing)\s+an\s+arm\s+and\s+a\s+leg\b/gi, phrase: 'cost an arm and a leg', uk: 'коштувати шалених грошей', note: 'сталий вираз' },
  { re: /\b(?:hit|hits|hitting)\s+the\s+nail\s+on\s+the\s+head\b/gi, phrase: 'hit the nail on the head', uk: 'влучити в саму точку', note: 'сталий вираз' },
  { re: /\bon\s+the\s+same\s+page\b/gi, phrase: 'on the same page', uk: 'на одній хвилі, мати спільне розуміння', note: 'сталий вираз' },
  { re: /\b(?:spill|spills|spilled|spilt|spilling)\s+the\s+beans\b/gi, phrase: 'spill the beans', uk: 'проговоритися, видати секрет', note: 'сталий вираз' },
  { re: /\b(?:cut|cuts|cutting)\s+corners\b/gi, phrase: 'cut corners', uk: 'халтурити, економити на якості', note: 'сталий вираз' },
  { re: /\bspeak\s+of\s+the\s+devil\b/gi, phrase: 'speak of the devil', uk: 'про вовка промовка', note: 'сталий вираз' },
  { re: /\b(?:a\s+)?blessing\s+in\s+disguise\b/gi, phrase: 'a blessing in disguise', uk: 'немає лиха без добра', note: 'сталий вираз' },
  { re: /\b(?:the\s+)?best\s+of\s+both\s+worlds\b/gi, phrase: 'the best of both worlds', uk: 'найкраще з обох варіантів', note: 'сталий вираз' },
  { re: /\b(?:bite|bites|bit|bitten|biting)\s+the\s+bullet\b/gi, phrase: 'bite the bullet', uk: 'зціпити зуби й наважитися', note: 'сталий вираз' },
  { re: /\b(?:call|calls|called|calling)\s+it\s+a\s+day\b/gi, phrase: 'call it a day', uk: 'на сьогодні досить, закінчувати роботу', note: 'сталий вираз' },
  { re: /\b(?:get|gets|got|gotten|getting)\s+out\s+of\s+hand\b/gi, phrase: 'get out of hand', uk: 'вийти з-під контролю', note: 'сталий вираз' },
  { re: /\b(?:miss|misses|missed|missing)\s+the\s+boat\b/gi, phrase: 'miss the boat', uk: 'проґавити шанс', note: 'сталий вираз' },
  { re: /\b(?:pull|pulls|pulled|pulling)\s+(?:myself|yourself|himself|herself|ourselves|themselves)\s+together\b/gi, phrase: 'pull yourself together', uk: 'взяти себе в руки', note: 'сталий вираз' },
  { re: /\b(?:make|makes|made|making)\s+up\s+(?:my|your|his|her|our|their)\s+mind\b/gi, phrase: 'make up one’s mind', uk: 'вирішити, визначитися', note: 'сталий вираз' },
  { re: /\b(?:change|changes|changed|changing)\s+(?:my|your|his|her|our|their)\s+mind\b/gi, phrase: 'change one’s mind', uk: 'передумати', note: 'сталий вираз' },
  { re: /\bnever\s+mind\b/gi, phrase: 'never mind', uk: 'не зважай, неважливо, забудь', note: 'сталий вираз' },
  { re: /\b(?:keep|keeps|kept|keeping|bear|bears|bore|bearing)\s+in\s+mind\b/gi, phrase: 'keep in mind', uk: 'мати на увазі, пам’ятати', note: 'сталий вираз' },
  { re: /\bout\s+of\s+(?:my|your|his|her|our|their)\s+mind\b/gi, phrase: 'out of one’s mind', uk: 'збожеволіти, не при своєму розумі', note: 'сталий вираз' },
  { re: /\b(?:wrap|wraps|wrapped|wrapping)\s+(?:my|your|his|her|our|their)\s+head\s+around\b/gi, phrase: 'wrap your head around', uk: 'усвідомити, вкласти в голові', note: 'сталий вираз' },
  { re: /\b(?:get|gets|got|gotten|getting)\s+the\s+hang\s+of\b/gi, phrase: 'get the hang of', uk: 'набити руку, розібратися як це працює', note: 'сталий вираз' },
  { re: /\b(?:go|goes|went|gone|going)\s+the\s+extra\s+mile\b/gi, phrase: 'go the extra mile', uk: 'докласти додаткових зусиль, перевершити очікування', note: 'сталий вираз' },
  { re: /\b(?:break|breaks|broke|broken|breaking)\s+the\s+ice\b/gi, phrase: 'break the ice', uk: 'розтопити лід, зняти напругу в спілкуванні', note: 'сталий вираз' },
  { re: /\b(?:keep|keeps|kept|keeping)\s+an\s+eye\s+on\b/gi, phrase: 'keep an eye on', uk: 'наглядати, стежити за', note: 'сталий вираз' },
  { re: /\b(?:lose|loses|lost|losing)\s+track\s+of\b/gi, phrase: 'lose track of', uk: 'втратити лік, загубити слід', note: 'сталий вираз' },
  { re: /\b(?:pay|pays|paid|paying)\s+attention\s+to\b/gi, phrase: 'pay attention to', uk: 'звертати увагу на', note: 'сталий вираз' },
  { re: /\boff\s+the\s+top\s+of\s+(?:my|your|his|her|our|their)\s+head\b/gi, phrase: 'off the top of my head', uk: 'навскидку, одразу з пам’яті', note: 'сталий вираз' },
  { re: /\bout\s+of\s+the\s+question\b/gi, phrase: 'out of the question', uk: 'виключено, навіть не обговорюється', note: 'сталий вираз' },
  { re: /\bit\s+goes\s+without\s+saying\b/gi, phrase: 'it goes without saying', uk: 'само собою зрозуміло', note: 'сталий вираз' },
  { re: /\bat\s+first\s+glance\b/gi, phrase: 'at first glance', uk: 'на перший погляд', note: 'сталий вираз' },
  { re: /\bin\s+a\s+nutshell\b/gi, phrase: 'in a nutshell', uk: 'коротко кажучи, якщо стисло', note: 'сталий вираз' },
  { re: /\blong\s+story\s+short\b/gi, phrase: 'long story short', uk: 'коротше кажучи', note: 'сталий вираз' },
  { re: /\bto\s+be\s+honest\b/gi, phrase: 'to be honest', uk: 'чесно кажучи', note: 'сталий вираз' },
  { re: /\bto\s+tell\s+the\s+truth\b/gi, phrase: 'to tell the truth', uk: 'правду кажучи', note: 'сталий вираз' },
  { re: /\bbelieve\s+it\s+or\s+not\b/gi, phrase: 'believe it or not', uk: 'хочеш вір, хочеш ні', note: 'сталий вираз' },
  { re: /\bno\s+wonder\b/gi, phrase: 'no wonder', uk: 'не дивно', note: 'сталий вираз' },
  { re: /\b(?:no\s+)?big\s+deal\b/gi, phrase: 'big deal', uk: 'велика справа / нічого страшного (з no)', note: 'сталий вираз' },
  { re: /\bfair\s+enough\b/gi, phrase: 'fair enough', uk: 'справедливо, слушно, домовились', note: 'сталий вираз' },
  { re: /\bbottom\s+line\b/gi, phrase: 'bottom line', uk: 'суть справи, головний підсумок', note: 'сталий вираз' },
  { re: /\bbehind\s+the\s+scenes\b/gi, phrase: 'behind the scenes', uk: 'за лаштунками', note: 'сталий вираз' },
  { re: /\bfrom\s+scratch\b/gi, phrase: 'from scratch', uk: 'з нуля', note: 'сталий вираз' },
  { re: /\bby\s+heart\b/gi, phrase: 'by heart', uk: 'напам’ять', note: 'сталий вираз' },
  { re: /\bon\s+purpose\b/gi, phrase: 'on purpose', uk: 'навмисно, спеціально', note: 'сталий вираз' },
  { re: /\bby\s+chance\b/gi, phrase: 'by chance', uk: 'випадково', note: 'сталий вираз' },
  { re: /\bby\s+mistake\b/gi, phrase: 'by mistake', uk: 'помилково', note: 'сталий вираз' },
  { re: /\bin\s+vain\b/gi, phrase: 'in vain', uk: 'марно, даремно', note: 'сталий вираз' },
  { re: /\bin\s+advance\b/gi, phrase: 'in advance', uk: 'заздалегідь', note: 'сталий вираз' },
  { re: /\bin\s+charge\s+of\b/gi, phrase: 'in charge of', uk: 'відповідальний за, керувати', note: 'сталий вираз' },
  { re: /\bon\s+(?:my|your|his|her|our|their)\s+own\b/gi, phrase: 'on one’s own', uk: 'самостійно, сам по собі', note: 'сталий вираз' },
  { re: /\bfor\s+good\b/gi, phrase: 'for good', uk: 'назавжди, остаточно', note: 'сталий вираз' },
  { re: /\bfor\s+a\s+while\b/gi, phrase: 'for a while', uk: 'деякий час, ненадовго', note: 'сталий вираз' },
  { re: /\bright\s+away\b/gi, phrase: 'right away', uk: 'негайно, одразу', note: 'сталий вираз' },
  { re: /\bso\s+far\b/gi, phrase: 'so far', uk: 'поки що, на цей момент', note: 'сталий вираз' },
  { re: /\bonce\s+in\s+a\s+while\b/gi, phrase: 'once in a while', uk: 'час від часу, інколи', note: 'сталий вираз' },
  { re: /\bevery\s+now\s+and\s+then\b/gi, phrase: 'every now and then', uk: 'час від часу, періодично', note: 'сталий вираз' },
  { re: /\bsooner\s+or\s+later\b/gi, phrase: 'sooner or later', uk: 'рано чи пізно', note: 'сталий вираз' },
  { re: /\bmore\s+or\s+less\b/gi, phrase: 'more or less', uk: 'більш-менш, приблизно', note: 'сталий вираз' },
  { re: /\bups\s+and\s+downs\b/gi, phrase: 'ups and downs', uk: 'злети і падіння', note: 'сталий вираз' },
  { re: /\bpros\s+and\s+cons\b/gi, phrase: 'pros and cons', uk: 'плюси і мінуси, за і проти', note: 'сталий вираз' },
  { re: /\btrial\s+and\s+error\b/gi, phrase: 'trial and error', uk: 'метод проб і помилок', note: 'сталий вираз' },
  { re: /\bback\s+and\s+forth\b/gi, phrase: 'back and forth', uk: 'туди-сюди, взад і вперед', note: 'сталий вираз' },
  { re: /\bkind\s+of\b/gi, phrase: 'kind of', uk: 'начебто, певною мірою, типу', note: 'сталий вираз' },
  { re: /\bsort\s+of\b/gi, phrase: 'sort of', uk: 'начебто, свого роду, типу', note: 'сталий вираз' },
  { re: /\bno\s+matter\s+(?:what|how|who|where|when|which)\b/gi, phrase: 'no matter what/how', uk: 'що б не сталося / як би там не було', note: 'сталий вираз' },
  { re: /\beven\s+though\b/gi, phrase: 'even though', uk: 'хоча, попри те що', note: 'сталий вираз' },
  { re: /\bas\s+soon\s+as\b/gi, phrase: 'as soon as', uk: 'щойно, як тільки', note: 'сталий вираз' },
  { re: /\bas\s+long\s+as\b/gi, phrase: 'as long as', uk: 'доки, за умови що', note: 'сталий вираз' },
  { re: /\bas\s+well\s+as\b/gi, phrase: 'as well as', uk: 'а також, так само як і', note: 'сталий вираз' },
  { re: /\bafter\s+all\b/gi, phrase: 'after all', uk: 'зрештою, адже, все-таки', note: 'сталий вираз' },
  { re: /\bat\s+least\b/gi, phrase: 'at least', uk: 'принаймні, щонайменше', note: 'сталий вираз' },
  { re: /\bat\s+all\b/gi, phrase: 'at all', uk: 'взагалі, зовсім', note: 'сталий вираз' },
  { re: /\babove\s+all\b/gi, phrase: 'above all', uk: 'перш за все, понад усе', note: 'сталий вираз' },
  { re: /\bfirst\s+of\s+all\b/gi, phrase: 'first of all', uk: 'насамперед, перш за все', note: 'сталий вираз' },
  { re: /\binstead\s+of\b/gi, phrase: 'instead of', uk: 'замість', note: 'сталий вираз' },
  { re: /\bin\s+fact\b/gi, phrase: 'in fact', uk: 'насправді, фактично', note: 'сталий вираз' },
  { re: /\bin\s+common\b/gi, phrase: 'in common', uk: 'спільного', note: 'сталий вираз' },
  { re: /\b(?:take|takes|took|taken|taking)\s+place\b/gi, phrase: 'take place', uk: 'відбуватися, мати місце', note: 'сталий вираз' },
  { re: /\b(?:take|takes|took|taken|taking)\s+part\s+in\b/gi, phrase: 'take part in', uk: 'брати участь у', note: 'сталий вираз' },
  { re: /\b(?:take|takes|took|taken|taking)\s+advantage\s+of\b/gi, phrase: 'take advantage of', uk: 'скористатися (перевагою / кимось)', note: 'сталий вираз' },
  { re: /\b(?:take|takes|took|taken|taking)\s+care\s+of\b/gi, phrase: 'take care of', uk: 'піклуватися про, подбати про', note: 'сталий вираз' },
  { re: /\b(?:make|makes|made|making)\s+sure\b/gi, phrase: 'make sure', uk: 'переконатися, простежити', note: 'сталий вираз' },
  { re: /\b(?:make|makes|made|making)\s+a\s+difference\b/gi, phrase: 'make a difference', uk: 'мати значення, змінювати на краще', note: 'сталий вираз' },
  { re: /\bused\s+to\b/gi, phrase: 'used to', uk: 'раніше (щось робив регулярно)', note: 'сталий вираз' },
  { re: /\bsupposed\s+to\b/gi, phrase: 'be supposed to', uk: 'має, повинен (за планом / правилом)', note: 'сталий вираз' },

  // High-frequency phrasal verbs
  { re: /\b(?:figure|figures|figured|figuring)\s+(?:it|this|that|them|everything|things|\w+)?\s*out\b/gi, phrase: 'figure out', uk: 'розібратися, з’ясувати, зрозуміти', note: 'фразове дієслово' },
  { re: /\b(?:give|gives|gave|given|giving)\s+(?:it|this|that|them|\w+)?\s*up\b/gi, phrase: 'give up', uk: 'здатися, кинути (звичку / справу)', note: 'фразове дієслово' },
  { re: /\b(?:give|gives|gave|given|giving)\s+in\b/gi, phrase: 'give in', uk: 'поступитися, здатися', note: 'фразове дієслово' },
  { re: /\b(?:get|gets|got|gotten|getting)\s+rid\s+of\b/gi, phrase: 'get rid of', uk: 'позбутися', note: 'фразове дієслово' },
  { re: /\b(?:come|comes|came|coming)\s+up\s+with\b/gi, phrase: 'come up with', uk: 'придумати, запропонувати (ідею)', note: 'фразове дієслово' },
  { re: /\b(?:look|looks|looked|looking)\s+forward\s+to\b/gi, phrase: 'look forward to', uk: 'з нетерпінням чекати на', note: 'фразове дієслово' },
  { re: /\b(?:run|runs|ran|running)\s+out\s+of\b/gi, phrase: 'run out of', uk: 'закінчитися (про запаси / час)', note: 'фразове дієслово' },
  { re: /\b(?:keep|keeps|kept|keeping)\s+up\s+with\b/gi, phrase: 'keep up with', uk: 'встигати за, йти в ногу з', note: 'фразове дієслово' },
  { re: /\b(?:put|puts|putting)\s+up\s+with\b/gi, phrase: 'put up with', uk: 'миритися з, терпіти', note: 'фразове дієслово' },
  { re: /\b(?:get|gets|got|gotten|getting)\s+along\s+with\b/gi, phrase: 'get along with', uk: 'ладнати з кимось', note: 'фразове дієслово' },
  { re: /\b(?:end|ends|ended|ending)\s+up\b/gi, phrase: 'end up', uk: 'зрештою опинитися / закінчити тим, що', note: 'фразове дієслово' },
  { re: /\b(?:turn|turns|turned|turning)\s+out\b/gi, phrase: 'turn out', uk: 'виявитися, вийти (у результаті)', note: 'фразове дієслово' },
  { re: /\b(?:turn|turns|turned|turning)\s+(?:it|this|that|them|him|her)?\s*down\b/gi, phrase: 'turn down', uk: 'відхилити (пропозицію) / зменшити звук', note: 'фразове дієслово' },
  { re: /\b(?:find|finds|found|finding)\s+out\b/gi, phrase: 'find out', uk: 'дізнатися, з’ясувати', note: 'фразове дієслово' },
  { re: /\b(?:point|points|pointed|pointing)\s+(?:it|this|that|them)?\s*out\b/gi, phrase: 'point out', uk: 'вказати на, зауважити', note: 'фразове дієслово' },
  { re: /\b(?:work|works|worked|working)\s+(?:it|this|that|things)?\s*out\b/gi, phrase: 'work out', uk: 'вийти (вдало) / тренуватися / вирішити', note: 'фразове дієслово' },
  { re: /\b(?:hang|hangs|hung|hanging)\s+out\b/gi, phrase: 'hang out', uk: 'тусуватися, проводити час разом', note: 'фразове дієслово' },
  { re: /\b(?:check|checks|checked|checking)\s+(?:it|this|that|them)?\s*out\b/gi, phrase: 'check out', uk: 'глянути, зацінити, перевірити', note: 'фразове дієслово' },
  { re: /\b(?:carry|carries|carried|carrying)\s+on\b/gi, phrase: 'carry on', uk: 'продовжувати', note: 'фразове дієслово' },
  { re: /\b(?:hold|holds|held|holding)\s+on\b/gi, phrase: 'hold on', uk: 'зачекай, тримайся', note: 'фразове дієслово' },
  { re: /\b(?:catch|catches|caught|catching)\s+up\b/gi, phrase: 'catch up', uk: 'наздогнати, поспілкуватися після паузи', note: 'фразове дієслово' },
  { re: /\b(?:show|shows|showed|shown|showing)\s+up\b/gi, phrase: 'show up', uk: 'з’явитися, прийти', note: 'фразове дієслово' },
  { re: /\b(?:grow|grows|grew|grown|growing)\s+up\b/gi, phrase: 'grow up', uk: 'вирости, подорослішати', note: 'фразове дієслово' },
  { re: /\b(?:wake|wakes|woke|woken|waking)\s+up\b/gi, phrase: 'wake up', uk: 'прокинутися', note: 'фразове дієслово' },
  { re: /\b(?:set|sets|setting)\s+(?:it|this|that|them)?\s*up\b/gi, phrase: 'set up', uk: 'налаштувати, організувати, створити', note: 'фразове дієслово' },
  { re: /\b(?:pick|picks|picked|picking)\s+(?:it|this|that|them|him|her|me|you|us)?\s*up\b/gi, phrase: 'pick up', uk: 'підібрати, підхопити, забрати', note: 'фразове дієслово' },
  { re: /\b(?:bring|brings|brought|bringing)\s+(?:it|this|that|them)?\s*up\b/gi, phrase: 'bring up', uk: 'підняти тему / виховати', note: 'фразове дієслово' },
  { re: /\b(?:break|breaks|broke|broken|breaking)\s+down\b/gi, phrase: 'break down', uk: 'зламатися / розкласти по поличках', note: 'фразове дієслово' },
  { re: /\b(?:cut|cuts|cutting)\s+(?:it|them|him|her|me|us)?\s*off\b/gi, phrase: 'cut off', uk: 'відрізати, перебити, припинити', note: 'фразове дієслово' },
  { re: /\b(?:pay|pays|paid|paying)\s+off\b/gi, phrase: 'pay off', uk: 'окупитися, принести плоди / виплатити борг', note: 'фразове дієслово' },
  { re: /\b(?:call|calls|called|calling)\s+(?:it|this|that)?\s*off\b/gi, phrase: 'call off', uk: 'скасувати', note: 'фразове дієслово' },
  { re: /\b(?:fall|falls|fell|fallen|falling)\s+apart\b/gi, phrase: 'fall apart', uk: 'розвалитися на шматки', note: 'фразове дієслово' },
  { re: /\b(?:get|gets|got|gotten|getting)\s+over\b/gi, phrase: 'get over', uk: 'пережити, оговтатися, подолати', note: 'фразове дієслово' },
  { re: /\b(?:go|goes|went|gone|going)\s+through\b/gi, phrase: 'go through', uk: 'проходити через, переживати (складний період)', note: 'фразове дієслово' },
  { re: /\b(?:come|comes|came|coming)\s+across\b/gi, phrase: 'come across', uk: 'натрапити на / справляти враження', note: 'фразове дієслово' },
  { re: /\b(?:burn|burns|burned|burnt|burning)\s+out\b/gi, phrase: 'burn out', uk: 'вигоріти (емоційно / фізично)', note: 'фразове дієслово' },
  { re: /\b(?:freak|freaks|freaked|freaking)\s+out\b/gi, phrase: 'freak out', uk: 'запанікувати, злякатися, ошаліти', note: 'фразове дієслово' },
  { re: /\b(?:chill|chills|chilled|chilling)\s+out\b/gi, phrase: 'chill out', uk: 'розслабитися, заспокоїтися', note: 'фразове дієслово' },
  { re: /\b(?:put|puts|putting)\s+(?:it|this|that)?\s*off\b/gi, phrase: 'put off', uk: 'відкласти на потім', note: 'фразове дієслово' },
  { re: /\b(?:take|takes|took|taken|taking)\s+off\b/gi, phrase: 'take off', uk: 'злетіти / зняти (одяг) / різко піти вгору', note: 'фразове дієслово' },
  { re: /\b(?:take|takes|took|taken|taking)\s+over\b/gi, phrase: 'take over', uk: 'перейняти контроль, очолити', note: 'фразове дієслово' },
  { re: /\b(?:look|looks|looked|looking)\s+after\b/gi, phrase: 'look after', uk: 'доглядати, піклуватися про', note: 'фразове дієслово' },
  { re: /\b(?:look|looks|looked|looking)\s+into\b/gi, phrase: 'look into', uk: 'дослідити, розібратися в питанні', note: 'фразове дієслово' },
  { re: /\b(?:look|looks|looked|looking)\s+up\s+to\b/gi, phrase: 'look up to', uk: 'поважати, рівнятися на когось', note: 'фразове дієслово' },
  { re: /\b(?:deal|deals|dealt|dealing)\s+with\b/gi, phrase: 'deal with', uk: 'мати справу з, справлятися з', note: 'фразове дієслово' },
  { re: /\b(?:watch|watches|watched|watching)\s+out\b/gi, phrase: 'watch out', uk: 'обережно, стережися', note: 'фразове дієслово' },
];

// Curated modern Ukrainian overrides for high-frequency tricky words where Google Translate's
// single-word `gtx` endpoint often picks bizarre archaic or homonym meanings.
const TRICKY_WORD_OVERRIDES = {
  will: {
    default: { translation: 'буде', alternatives: ['воля', 'бажання', 'заповіт'], partOfSpeech: 'auxiliary', partOfSpeechUk: 'допоміжне дієслово' },
    noun: { translation: 'воля', alternatives: ['бажання', 'заповіт', 'рішучість'], partOfSpeech: 'noun', partOfSpeechUk: 'іменник' },
  },
  would: {
    default: { translation: 'би (умовний спосіб)', alternatives: ['було б', 'раніше (робив)'], partOfSpeech: 'modal', partOfSpeechUk: 'модальне дієслово' },
  },
  may: {
    default: { translation: 'може', alternatives: ['можливо', 'дозвольте', 'травень'], partOfSpeech: 'modal', partOfSpeechUk: 'модальне дієслово' },
    noun: { translation: 'травень', alternatives: ['може', 'можливо'], partOfSpeech: 'noun', partOfSpeechUk: 'іменник' },
  },
  might: {
    default: { translation: 'можливо', alternatives: ['міг би', 'може', 'міць'], partOfSpeech: 'modal', partOfSpeechUk: 'модальне дієслово' },
  },
  can: {
    default: { translation: 'може', alternatives: ['вміє', 'можна', 'бляшанка'], partOfSpeech: 'modal', partOfSpeechUk: 'модальне дієслово' },
    noun: { translation: 'бляшанка', alternatives: ['банка', 'каністра', 'може'], partOfSpeech: 'noun', partOfSpeechUk: 'іменник' },
  },
  could: {
    default: { translation: 'міг би', alternatives: ['міг', 'можна було б'], partOfSpeech: 'modal', partOfSpeechUk: 'модальне дієслово' },
  },
  should: {
    default: { translation: 'повинен', alternatives: ['слід', 'варто', 'мав би'], partOfSpeech: 'modal', partOfSpeechUk: 'модальне дієслово' },
  },
  must: {
    default: { translation: 'повинен', alternatives: ['мусить', 'обов’язково', 'напевно'], partOfSpeech: 'modal', partOfSpeechUk: 'модальне дієслово' },
  },
  mean: {
    verb: { translation: 'означати', alternatives: ['мати на увазі', 'значити', 'намірятися'], partOfSpeech: 'verb', partOfSpeechUk: 'дієслово' },
    adjective: { translation: 'підлий', alternatives: ['злий', 'жорстокий', 'середній'], partOfSpeech: 'adjective', partOfSpeechUk: 'прикметник' },
    default: { translation: 'означати', alternatives: ['мати на увазі', 'підлий', 'середній'], partOfSpeech: 'verb', partOfSpeechUk: 'дієслово' },
  },
  watch: {
    verb: { translation: 'дивитися', alternatives: ['спостерігати', 'стежити', 'пильнувати'], partOfSpeech: 'verb', partOfSpeechUk: 'дієслово' },
    noun: { translation: 'годинник', alternatives: ['наручний годинник', 'спостереження', 'варта'], partOfSpeech: 'noun', partOfSpeechUk: 'іменник' },
    default: { translation: 'дивитися', alternatives: ['спостерігати', 'годинник'], partOfSpeech: 'verb', partOfSpeechUk: 'дієслово' },
  },
  kind: {
    adjective: { translation: 'добрий', alternatives: ['люб’язний', 'привітний', 'чуйний'], partOfSpeech: 'adjective', partOfSpeechUk: 'прикметник' },
    noun: { translation: 'вид', alternatives: ['тип', 'різновид', 'сорт'], partOfSpeech: 'noun', partOfSpeechUk: 'іменник' },
    default: { translation: 'вид', alternatives: ['тип', 'добрий', 'люб’язний'], partOfSpeech: 'noun', partOfSpeechUk: 'іменник' },
  },
  well: {
    default: { translation: 'добре', alternatives: ['ну', 'що ж', 'колодязь'], partOfSpeech: 'adverb', partOfSpeechUk: 'прислівник' },
    noun: { translation: 'колодязь', alternatives: ['криниця', 'свердловина', 'добре'], partOfSpeech: 'noun', partOfSpeechUk: 'іменник' },
  },
  just: {
    default: { translation: 'просто', alternatives: ['щойно', 'лише', 'саме', 'справедливий'], partOfSpeech: 'adverb', partOfSpeechUk: 'прислівник' },
  },
  like: {
    verb: { translation: 'подобатися', alternatives: ['любити', 'хотіти'], partOfSpeech: 'verb', partOfSpeechUk: 'дієслово' },
    default: { translation: 'як', alternatives: ['подобатися', 'наче', 'схожий', 'типу'], partOfSpeech: 'preposition', partOfSpeechUk: 'прийменник' },
  },
  right: {
    default: { translation: 'правильно', alternatives: ['правий', 'право', 'одразу', 'саме'], partOfSpeech: 'adjective', partOfSpeechUk: 'прикметник' },
    noun: { translation: 'право', alternatives: ['правий бік', 'правильно'], partOfSpeech: 'noun', partOfSpeechUk: 'іменник' },
  },
  still: {
    default: { translation: 'все ще', alternatives: ['досі', 'все одно', 'нерухомий', 'тихий'], partOfSpeech: 'adverb', partOfSpeechUk: 'прислівник' },
  },
  even: {
    default: { translation: 'навіть', alternatives: ['рівний', 'парний', 'ще більш'], partOfSpeech: 'adverb', partOfSpeechUk: 'прислівник' },
  },
  pretty: {
    adverb: { translation: 'досить', alternatives: ['доволі', 'чимало', 'гарний'], partOfSpeech: 'adverb', partOfSpeechUk: 'прислівник' },
    adjective: { translation: 'гарний', alternatives: ['симпатичний', 'милий', 'досить'], partOfSpeech: 'adjective', partOfSpeechUk: 'прикметник' },
  },
  mind: {
    verb: { translation: 'заперечувати', alternatives: ['зважати', 'бути проти'], partOfSpeech: 'verb', partOfSpeechUk: 'дієслово' },
    noun: { translation: 'розум', alternatives: ['думка', 'свідомість', 'пам’ять'], partOfSpeech: 'noun', partOfSpeechUk: 'іменник' },
  },
  figure: {
    verb: { translation: 'вважати', alternatives: ['розраховувати', 'уявляти', 'з’ясувати'], partOfSpeech: 'verb', partOfSpeechUk: 'дієслово' },
    noun: { translation: 'цифра', alternatives: ['постать', 'фігура', 'показник'], partOfSpeech: 'noun', partOfSpeechUk: 'іменник' },
  },
  out: {
    default: { translation: 'назовні', alternatives: ['поза', 'з', 'геть'], partOfSpeech: 'adverb', partOfSpeechUk: 'прислівник' },
  },
  up: {
    default: { translation: 'вгору', alternatives: ['нагорі', 'догори'], partOfSpeech: 'adverb', partOfSpeechUk: 'прислівник' },
  },
  off: {
    default: { translation: 'геть', alternatives: ['вимкнено', 'з', 'від'], partOfSpeech: 'adverb', partOfSpeechUk: 'прислівник' },
  },
  over: {
    default: { translation: 'над', alternatives: ['через', 'понад', 'закінчено'], partOfSpeech: 'preposition', partOfSpeechUk: 'прийменник' },
  },
  back: {
    verb: { translation: 'підтримувати', alternatives: ['відступати', 'здавати назад'], partOfSpeech: 'verb', partOfSpeechUk: 'дієслово' },
    noun: { translation: 'спина', alternatives: ['задня частина', 'назад'], partOfSpeech: 'noun', partOfSpeechUk: 'іменник' },
    default: { translation: 'назад', alternatives: ['спина', 'повернутися'], partOfSpeech: 'adverb', partOfSpeechUk: 'прислівник' },
  },
};

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectIdiomInSentence(sentence, clickedWord) {
  const cleanSent = String(sentence || '').trim();
  const target = String(clickedWord || '').replace(/’/g, "'").trim().toLowerCase();
  if (!cleanSent || !target) return null;

  const wordRe = new RegExp(`\\b${escapeRegExp(target)}\\b`, 'i');

  for (const rule of IDIOM_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(cleanSent)) !== null) {
      if (wordRe.test(m[0])) {
        return {
          phrase: m[0].trim(),
          canonical: rule.phrase,
          phraseTranslation: rule.uk,
          phraseNote: rule.note,
        };
      }
    }
  }
  return null;
}

function inferContextPos(wordLower, sentence) {
  const s = String(sentence || '').replace(/’/g, "'").trim();
  if (!s) return null;

  const w = escapeRegExp(wordLower);

  // Specific high-signal patterns
  if (wordLower === 'may' && /\b(?:in|during|of|last|next|every)\s+May\b/.test(s)) {
    return 'noun';
  }
  if (
    wordLower === 'pretty' &&
    new RegExp(`\\bpretty\\s+(?:good|bad|well|much|sure|close|fast|hard|easy|big|small|cool|nice|crazy|simple|clear|far|high|low|long|short|important|interesting|different|similar|common|hard|rough)\\b`, 'i').test(s)
  ) {
    return 'adverb';
  }

  // Infinitive / auxiliary / subject pronoun before word -> verb
  const verbBeforeRe = new RegExp(
    `\\b(?:to|will|would|can|could|should|must|may|might|don't|doesn't|didn't|won't|can't|couldn't|shouldn't|never|always|just|really|let's|i|you|we|they)\\s+${w}\\b`,
    'i'
  );
  // Article / possessive / determiner (with optional adjective) before word -> noun
  const nounBeforeRe = new RegExp(
    `\\b(?:a|an|the|my|your|his|her|its|our|their|this|that|these|those|some|any|no|every|each)\\s+(?:[a-z-]+\\s+)?${w}(?:\\s+(?:is|was|are|were|has|had|of|in|on|at|for|with|to|and|or|but|that|which)|[.,!?;:]|$)`,
    'i'
  );
  const adjContextRe = new RegExp(
    `\\b(?:is|are|was|were|be|been|being|very|so|too|really|quite|pretty|super|extremely|feel|feels|felt|seem|seems|seemed|look|looks|looked)\\s+${w}\\b`,
    'i'
  );

  if (nounBeforeRe.test(s)) return 'noun';
  if (verbBeforeRe.test(s)) return 'verb';
  if (adjContextRe.test(s)) return 'adjective';
  if (wordLower.endsWith('ly') && wordLower.length > 4) return 'adverb';
  return null;
}

async function fetchWithTimeout(url, timeoutMs = 4500, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function fetchDictionaryMeta(word, preferredPos = null) {
  try {
    const res = await fetchWithTimeout(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      2600
    );
    if (!res.ok) return { phonetic: '', audio: '', partOfSpeech: '', partOfSpeechUk: '' };
    const data = await res.json();
    const entries = Array.isArray(data) ? data : [];
    if (entries.length === 0) {
      return { phonetic: '', audio: '', partOfSpeech: '', partOfSpeechUk: '' };
    }

    const phoneticCandidates = [];
    let audio = '';
    const posList = [];

    for (const entry of entries) {
      if (entry?.phonetic) phoneticCandidates.push(String(entry.phonetic).trim());
      if (Array.isArray(entry?.phonetics)) {
        for (const p of entry.phonetics) {
          if (p?.text) phoneticCandidates.push(String(p.text).trim());
          if (!audio && p?.audio) audio = String(p.audio).trim();
          else if (p?.audio && /us\.mp3$/i.test(String(p.audio))) {
            audio = String(p.audio).trim();
          }
        }
      }
      if (Array.isArray(entry?.meanings)) {
        for (const m of entry.meanings) {
          const pos = String(m?.partOfSpeech || '').toLowerCase().trim();
          if (pos && !posList.includes(pos)) posList.push(pos);
        }
      }
    }

    // Prefer complete IPA transcription (not truncated like "/ˈkjɔː-/")
    const completePhons = phoneticCandidates.filter((p) => p && !/-\s*\/?$/.test(p));
    const pool = completePhons.length > 0 ? completePhons : phoneticCandidates;
    const phonetic = pool.sort((a, b) => b.length - a.length)[0] || '';

    const partOfSpeech =
      (preferredPos && posList.includes(preferredPos) ? preferredPos : posList[0]) || '';
    const partOfSpeechUk = partOfSpeech ? POS_UK[partOfSpeech] || partOfSpeech : '';

    return { phonetic, audio, partOfSpeech, partOfSpeechUk };
  } catch {
    return { phonetic: '', audio: '', partOfSpeech: '', partOfSpeechUk: '' };
  }
}

function buildAiPrompt(word, sentence) {
  const hasSentence = Boolean(sentence && sentence.trim());
  return [
    'Ти — професійний англо-український словник і викладач англійської для українців.',
    `Цільове слово: "${word}"`,
    hasSentence ? `Контекст (речення): "${sentence}"` : 'Контекст: немає (окреме слово).',
    '',
    'Правила:',
    '- Перекладай сучасною, природною українською мовою без русизмів і застарілих словникових значень.',
    '- Якщо цільове слово входить у сталий вираз, ідіому чи фразове дієслово у цьому реченні (наприклад break a leg, at the end of the day, figure out, take for granted, piece of cake), заповни поля phrase, phraseTranslation і phraseNote, А ТАКОЖ обовʼязково використай цей природний небуквальний переклад ідіоми всередині sentenceTranslation (НЕ перекладай ідіому дослівно в реченні!).',
    '',
    'Поверни ТІЛЬКИ валідний JSON без markdown-обгортки з такими полями:',
    '{',
    '  "translation": "найточніший сучасний український переклад слова САМЕ в цьому контексті (1-3 слова)",',
    '  "alternatives": ["3-5 інших природних українських значень або синонімів цього слова"],',
    '  "partOfSpeechUk": "одна частина мови українською саме в цьому реченні (дієслово, іменник, прикметник, прислівник, модальне дієслово, допоміжне дієслово, прийменник, сполучник, займенник, вигук)",',
    '  "phrase": "англійський сталий вираз або фразове дієслово з цього речення, якщо слово є його частиною; інакше порожній рядок",',
    '  "phraseTranslation": "природний український відповідник цього сталого виразу (НЕ дослівний), або порожній рядок якщо phrase порожній",',
    '  "phraseNote": "сталий вираз або фразове дієслово (або порожній рядок якщо phrase порожній)",',
    '  "sentenceTranslation": "природний, живий український переклад усього речення з обовʼязковим урахуванням ідіом і сталих виразів (або порожній рядок якщо контексту немає)"',
    '}',
  ].join('\n');
}

function parseAiJson(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function translateViaGemini(word, sentence) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const models = [
    process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const prompt = buildAiPrompt(word, sentence);

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const generationConfig = {
        temperature: 0.1,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      };
      if (model.includes('2.5')) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      const res = await fetchWithTimeout(url, 6500, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig,
        }),
      });
      if (!res.ok) continue;

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = parseAiJson(text);
      if (parsed && typeof parsed.translation === 'string' && parsed.translation.trim()) {
        return parsed;
      }
    } catch {
      // try next Gemini model or fallback
    }
  }
  return null;
}

async function translateViaOpenAiCompatible({ url, apiKey, model, word, sentence, extraHeaders = {} }) {
  if (!apiKey) return null;
  try {
    const res = await fetchWithTimeout(url, 6500, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 512,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a concise English-to-Ukrainian dictionary assistant. Reply strictly with valid JSON.',
          },
          { role: 'user', content: buildAiPrompt(word, sentence) },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const parsed = parseAiJson(text);
    if (parsed && typeof parsed.translation === 'string' && parsed.translation.trim()) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function tryAiTranslation(word, sentence) {
  if (process.env.GEMINI_API_KEY) {
    const res = await translateViaGemini(word, sentence);
    if (res) return res;
  }

  if (process.env.GROQ_API_KEY) {
    const res = await translateViaOpenAiCompatible({
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      word,
      sentence,
    });
    if (res) return res;
  }

  if (process.env.OPENROUTER_API_KEY) {
    const res = await translateViaOpenAiCompatible({
      url: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
      word,
      sentence,
      extraHeaders: { 'X-Title': 'Lexivue' },
    });
    if (res) return res;
  }

  return null;
}

async function googleTranslateEnToUk(text, includeDict = false) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'en',
    tl: 'uk',
    q: text,
  });
  let url = `https://translate.googleapis.com/translate_a/single?${params.toString()}&dt=t`;
  if (includeDict) url += '&dt=at&dt=bd';

  const res = await fetchWithTimeout(url, 4500, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error('Google Translate API failed');
  return res.json();
}

async function myMemoryTranslateEnToUk(text) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|uk`;
  const res = await fetchWithTimeout(url, 4500);
  if (!res.ok) return '';
  const data = await res.json();
  const translated = String(data?.responseData?.translatedText || '').trim();
  if (!translated || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translated)) {
    return '';
  }
  return translated;
}

function shouldLookupLowercase(cleaned, sentence) {
  // Keep all-caps acronyms like NASA, USA, AI
  if (cleaned.length >= 2 && cleaned === cleaned.toUpperCase()) return false;
  // Always lowercase single-word lookup if capitalized at start of sentence or standalone
  // (prevents Google Translate turning "Will" -> "Воля", "May" -> "травня", "Mean" -> "Середній")
  if (!sentence) return true;
  const escaped = escapeRegExp(cleaned);
  const midSentenceProper = new RegExp(`[a-z0-9,]\\s+${escaped}\\b`).test(sentence);
  // Even mid-sentence, common words like "I" or capitalized words in titles should be lowercased
  if (!midSentenceProper) return true;
  if (TRICKY_WORD_OVERRIDES[cleaned.toLowerCase()]) return true;
  return false;
}

function extractSmartGoogleWordData(gtResult, lower, inferredPos) {
  let mainTranslation = Array.isArray(gtResult?.[0])
    ? gtResult[0].map((part) => part?.[0] || '').join('').trim()
    : '';

  const alternatives = [];
  const pushAlt = (term) => {
    if (typeof term !== 'string') return;
    const t = term.trim();
    if (!t) return;
    if (t.toLowerCase() === mainTranslation.toLowerCase()) return;
    if (alternatives.some((a) => a.toLowerCase() === t.toLowerCase())) return;
    if (alternatives.length < 5) alternatives.push(t);
  };

  // 1. Prefer neural-ranked alternatives from dt=at (gtResult[5]) — much cleaner than alphabetical dt=bd!
  const atEntries = gtResult?.[5]?.[0]?.[2];
  if (Array.isArray(atEntries)) {
    for (const entry of atEntries) {
      if (typeof entry?.[0] === 'string') {
        pushAlt(entry[0]);
      }
    }
  }

  // 2. Determine the RIGHT part of speech from dt=bd (gtResult[1]) instead of blindly taking the
  //    alphabetically first group (which was almost always `adjective` -> bizarre homonyms!).
  let partOfSpeech = '';
  let partOfSpeechUk = '';

  const dictGroups = Array.isArray(gtResult?.[1]) ? gtResult[1] : [];
  if (dictGroups.length > 0) {
    const mainLower = mainTranslation.toLowerCase();

    // Priority A: group matching contextual POS inferred from the sentence
    let chosenGroup = inferredPos
      ? dictGroups.find((g) => {
          const p = String(g?.[0] || '').toLowerCase();
          return p === inferredPos || (inferredPos === 'verb' && p === 'auxiliary verb');
        })
      : null;

    // Priority B: group that actually contains the neural mainTranslation
    if (!chosenGroup && mainLower) {
      chosenGroup = dictGroups.find((g) =>
        Array.isArray(g?.[1]) &&
        g[1].some((term) => typeof term === 'string' && term.toLowerCase() === mainLower)
      );
    }

    // Priority C: prefer noun/verb/adverb/adjective in natural order rather than raw alphabetical
    if (!chosenGroup) {
      const posOrder = ['verb', 'auxiliary verb', 'noun', 'adjective', 'adverb', 'preposition', 'conjunction'];
      for (const p of posOrder) {
        chosenGroup = dictGroups.find((g) => String(g?.[0] || '').toLowerCase() === p);
        if (chosenGroup) break;
      }
      if (!chosenGroup) chosenGroup = dictGroups[0];
    }

    if (chosenGroup) {
      const pos = String(chosenGroup[0] || '').toLowerCase();
      partOfSpeech = pos;
      partOfSpeechUk = POS_UK[pos] || pos;

      // Only pull extra alternatives from the CHOSEN (context-relevant) group if we still have < 5 alts
      const terms = Array.isArray(chosenGroup[1]) ? chosenGroup[1] : [];
      for (const term of terms) {
        if (alternatives.length >= 5) break;
        pushAlt(term);
      }
    }
  }

  // Apply curated overrides for notoriously mangled high-frequency words
  const overrideEntry = TRICKY_WORD_OVERRIDES[lower];
  if (overrideEntry) {
    const picked = (inferredPos && overrideEntry[inferredPos]) || overrideEntry.default;
    if (picked) {
      mainTranslation = picked.translation;
      alternatives.length = 0;
      for (const a of picked.alternatives) pushAlt(a);
      partOfSpeech = picked.partOfSpeech;
      partOfSpeechUk = picked.partOfSpeechUk;
    }
  }

  return { mainTranslation, alternatives, partOfSpeech, partOfSpeechUk };
}

export async function translateWordEnhanced(rawWord, sentence = '') {
  const cleaned = String(rawWord || '')
    .trim()
    .replace(/^[^a-zA-Z'-]+|[^a-zA-Z'-]+$/g, '');

  if (!cleaned) {
    return { status: 400, body: { error: 'Слово не вказано.' } };
  }

  const lower = cleaned.toLowerCase();
  const trimmedSentence = String(sentence || '').replace(/\s+/g, ' ').trim().slice(0, 460);
  const cacheKey = `${lower}::${trimmedSentence}`;

  if (translateCache.has(cacheKey)) {
    return { status: 200, body: { ...translateCache.get(cacheKey), word: cleaned } };
  }

  // Always fetch pronunciation / phonetics in parallel (fast & cached by browser/edge)
  const inferredPos = inferContextPos(lower, trimmedSentence);
  const dictMetaPromise = fetchDictionaryMeta(lower, inferredPos);

  // TIER 1: Try AI contextual model (Gemini / Groq / OpenRouter) if API key is configured
  const aiResult = await tryAiTranslation(cleaned, trimmedSentence);
  if (aiResult) {
    const dictMeta = await dictMetaPromise;
    const cleanAlts = Array.isArray(aiResult.alternatives)
      ? aiResult.alternatives
          .map((a) => String(a || '').trim())
          .filter(
            (a, idx, arr) =>
              a &&
              a.toLowerCase() !== aiResult.translation.trim().toLowerCase() &&
              arr.findIndex((x) => x.toLowerCase() === a.toLowerCase()) === idx
          )
          .slice(0, 5)
      : [];

    const detectedFallback =
      !aiResult.phrase && trimmedSentence ? detectIdiomInSentence(trimmedSentence, cleaned) : null;

    const payload = {
      word: cleaned,
      normalized: lower,
      translation: aiResult.translation.trim(),
      alternatives: cleanAlts,
      partOfSpeech: dictMeta.partOfSpeech || '',
      partOfSpeechUk:
        String(aiResult.partOfSpeechUk || '').trim().toLowerCase() || dictMeta.partOfSpeechUk,
      phonetic: dictMeta.phonetic,
      audio: dictMeta.audio,
      phrase: String(aiResult.phrase || detectedFallback?.phrase || '').trim(),
      phraseTranslation: String(
        aiResult.phraseTranslation || detectedFallback?.phraseTranslation || ''
      ).trim(),
      phraseNote: String(aiResult.phraseNote || detectedFallback?.phraseNote || '').trim(),
      sentence: trimmedSentence,
      sentenceTranslation: String(aiResult.sentenceTranslation || '').trim(),
      provider: 'ai',
    };

    setCache(cacheKey, payload);
    return { status: 200, body: payload };
  }

  // TIER 2: Upgraded Smart Keyless Engine (no API key needed, context-aware POS + dt=at + idiom detector)
  const lookupQuery = shouldLookupLowercase(cleaned, trimmedSentence) ? lower : cleaned;
  const idiomMatch = trimmedSentence ? detectIdiomInSentence(trimmedSentence, cleaned) : null;

  const sentCacheKey = trimmedSentence ? `sent:${trimmedSentence}` : '';
  const sentencePromise = trimmedSentence
    ? translateCache.has(sentCacheKey)
      ? Promise.resolve(translateCache.get(sentCacheKey))
      : googleTranslateEnToUk(trimmedSentence, false)
          .then((sentData) =>
            Array.isArray(sentData?.[0])
              ? sentData[0].map((part) => part?.[0] || '').join('').trim()
              : ''
          )
          .catch(() => myMemoryTranslateEnToUk(trimmedSentence).catch(() => ''))
    : Promise.resolve('');

  const [gtResult, dictMeta, sentenceTranslation] = await Promise.all([
    googleTranslateEnToUk(lookupQuery, true).catch(() => null),
    dictMetaPromise,
    sentencePromise,
  ]);

  let { mainTranslation, alternatives, partOfSpeech, partOfSpeechUk } =
    extractSmartGoogleWordData(gtResult, lower, inferredPos);

  if (!partOfSpeech && dictMeta.partOfSpeech) {
    partOfSpeech = dictMeta.partOfSpeech;
  }
  if (!partOfSpeechUk && dictMeta.partOfSpeechUk) {
    partOfSpeechUk = dictMeta.partOfSpeechUk;
  }

  if (!mainTranslation) {
    mainTranslation = await myMemoryTranslateEnToUk(lookupQuery).catch(() => '');
  }

  if (!mainTranslation) {
    return {
      status: 502,
      body: { error: 'Не вдалося перекласти слово. Спробуйте ще раз.' },
    };
  }

  if (trimmedSentence && sentenceTranslation) {
    setCache(sentCacheKey, sentenceTranslation);
  }

  const payload = {
    word: cleaned,
    normalized: lower,
    translation: mainTranslation,
    alternatives,
    partOfSpeech,
    partOfSpeechUk,
    phonetic: dictMeta.phonetic,
    audio: dictMeta.audio,
    phrase: idiomMatch?.phrase || '',
    phraseTranslation: idiomMatch?.phraseTranslation || '',
    phraseNote: idiomMatch?.phraseNote || '',
    sentence: trimmedSentence,
    sentenceTranslation,
    provider: 'dictionary',
  };

  setCache(cacheKey, payload);
  return { status: 200, body: payload };
}
