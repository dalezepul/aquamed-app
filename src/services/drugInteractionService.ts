/**
 * drugInteractionService.ts
 *
 * Offline drug-drug interaction check. Pure TypeScript (no React Native imports).
 *
 *  name ("Coraspin 300mg tablet") --normalize--> "coraspin"
 *       --NAME_INDEX--> ingredients (INN)  ["aspirin"]
 *       --INGREDIENT_CLASSES--> classes    ["nsaid", "antiplatelet"]
 *       --RULES (matched in both directions)--> interaction
 *
 * Rules are symmetric by construction: `ruleMatches` tries (a,b) and (b,a),
 * so the old "unsorted key never matches" bug cannot happen.
 */

import { MEDICATION_INGREDIENTS } from '../constants/medications';

// ============================================================================
// Types
// ============================================================================

export type InteractionSeverity = 'contraindicated' | 'major' | 'moderate';

export interface InteractionHit {
  /** The existing medication name exactly as the caller passed it. */
  with: string;
  severity: InteractionSeverity;
  messageTr: string;
  messageEn: string;
  /** Hours to keep between the two doses when spacing helps; 0 = spacing does not help. See spacingFor(). */
  spacingHours?: number;
}

export interface InteractionCheckResult {
  interactions: InteractionHit[];
  /** Input names that could not be mapped to any active ingredient. */
  unrecognized: string[];
  disclaimerKey: 'interactions.disclaimer';
}

/** Substance ("warfarin"), class ("@nsaid") or any-of list. */
type Matcher = string | string[];

export interface InteractionRule {
  a: Matcher;
  b: Matcher;
  severity: InteractionSeverity;
  tr: string;
  en: string;
  /** Minimum hours between doses that avoids the interaction; 0 = timing does not help. */
  spacingHours?: number;
}

/** Always-visible scope warning (i18n key: interactions.disclaimer). */
export const INTERACTION_DISCLAIMER = {
  key: 'interactions.disclaimer' as const,
  tr: 'Bu kontrol yalnızca sınırlı sayıda bilinen ilaç etkileşimini kapsar. Uyarı çıkmaması, ilaçların birlikte güvenle kullanılabileceği anlamına gelmez. Bir ilaca başlamadan, bırakmadan ya da dozunu değiştirmeden önce doktorunuza veya eczacınıza danışın.',
  en: 'This check covers only a limited set of known drug interactions. No warning does not mean the medicines are safe to take together. Talk to your doctor or pharmacist before starting, stopping or changing any medicine.',
};

// ============================================================================
// Ingredients -> classes
// ============================================================================

const cls = (classes: string[], names: string[]) =>
  Object.fromEntries(names.map(n => [n, classes])) as Record<string, string[]>;

/** INN (lowercase ASCII) -> classes. Ingredients only referenced by brands get []. */
export const INGREDIENT_CLASSES: Record<string, string[]> = {
  aspirin: ['nsaid', 'antiplatelet'],
  ...cls(['nsaid'], [
    'ibuprofen', 'naproxen', 'flurbiprofen', 'diclofenac', 'dexketoprofen', 'ketoprofen',
    'meloxicam', 'celecoxib', 'etoricoxib', 'etodolac', 'tenoxicam', 'lornoxicam',
    'piroxicam', 'indomethacin', 'mefenamic acid',
  ]),
  warfarin: ['anticoagulant', 'anticoagulant_vka'],
  ...cls(['anticoagulant', 'doac'], ['rivaroxaban', 'apixaban', 'edoxaban', 'dabigatran']),
  ...cls(['antiplatelet'], ['clopidogrel', 'prasugrel', 'ticagrelor']),
  ...cls(['ssri', 'serotonergic'], ['fluoxetine', 'sertraline', 'paroxetine', 'citalopram', 'escitalopram', 'fluvoxamine']),
  ...cls(['snri', 'serotonergic'], ['venlafaxine', 'duloxetine']),
  ...cls(['maoi'], ['moclobemide', 'phenelzine', 'selegiline', 'rasagiline', 'tranylcypromine']),
  tramadol: ['opioid', 'serotonergic'],
  ...cls(['opioid'], ['fentanyl', 'morphine', 'codeine', 'oxycodone', 'hydrocodone', 'methadone', 'buprenorphine', 'tapentadol']),
  ...cls(['benzodiazepine'], ['alprazolam', 'lorazepam', 'diazepam', 'clonazepam', 'temazepam', 'midazolam', 'chlordiazepoxide']),
  ...cls(['pde5'], ['sildenafil', 'tadalafil', 'vardenafil', 'avanafil']),
  ...cls(['nitrate'], ['nitroglycerin', 'isosorbide dinitrate', 'isosorbide mononitrate']),
  ...cls(['statin', 'statin_cyp3a4'], ['simvastatin', 'atorvastatin', 'lovastatin']),
  ...cls(['statin'], ['rosuvastatin', 'pravastatin', 'fluvastatin', 'pitavastatin']),
  ...cls(['macrolide', 'macrolide_cyp3a4'], ['clarithromycin', 'erythromycin']),
  ...cls(['macrolide'], ['azithromycin', 'roxithromycin']),
  ...cls(['azole'], ['fluconazole', 'itraconazole', 'ketoconazole', 'voriconazole', 'posaconazole']),
  ...cls(['ace_inhibitor'], ['lisinopril', 'enalapril', 'ramipril', 'perindopril', 'benazepril', 'quinapril', 'captopril', 'fosinopril', 'zofenopril']),
  ...cls(['arb'], ['losartan', 'valsartan', 'irbesartan', 'candesartan', 'telmisartan', 'olmesartan']),
  ...cls(['potassium_sparing'], ['spironolactone', 'eplerenone', 'amiloride', 'triamterene']),
  ...cls(['potassium'], ['potassium chloride', 'potassium citrate']),
  ...cls(['diuretic'], ['hydrochlorothiazide', 'chlorthalidone', 'indapamide', 'furosemide', 'torsemide', 'bumetanide']),
  ...cls(['ppi'], ['omeprazole', 'esomeprazole', 'pantoprazole', 'lansoprazole']),
  lithium: ['lithium'],
  metformin: ['metformin'],
  alcohol: ['alcohol'],
};

// ============================================================================
// Names -> ingredients (brands, Turkish spellings). Keys are normalized at build time.
// ============================================================================

const NAME_TO_INGREDIENTS: Record<string, string[]> = {
  // --- autocomplete list (constants/medications.ts); the hand-curated entries below override it ---
  ...MEDICATION_INGREDIENTS,

  // --- generic spellings (TR / US / salt forms) ---
  'acetylsalicylic acid': ['aspirin'], 'asetilsalisilik asit': ['aspirin'], asa: ['aspirin'],
  acetaminophen: ['paracetamol'], parasetamol: ['paracetamol'],
  varfarin: ['warfarin'], 'warfarin sodium': ['warfarin'],
  naproksen: ['naproxen'], 'naproxen sodium': ['naproxen'], 'naproksen sodyum': ['naproxen'],
  diklofenak: ['diclofenac'], deksketoprofen: ['dexketoprofen'], ketoprofen: ['ketoprofen'],
  meloksikam: ['meloxicam'], selekoksib: ['celecoxib'], etodolak: ['etodolac'], tenoksikam: ['tenoxicam'],
  'mefenamik asit': ['mefenamic acid'], indometazin: ['indomethacin'], metamizol: ['metamizole'],
  klopidogrel: ['clopidogrel'], tikagrelor: ['ticagrelor'],
  rivaroksaban: ['rivaroxaban'], apiksaban: ['apixaban'], edoksaban: ['edoxaban'],
  fluoksetin: ['fluoxetine'], sertralin: ['sertraline'], paroksetin: ['paroxetine'],
  sitalopram: ['citalopram'], essitalopram: ['escitalopram'], esitalopram: ['escitalopram'],
  venlafaksin: ['venlafaxine'], duloksetin: ['duloxetine'], moklobemid: ['moclobemide'],
  selejilin: ['selegiline'], rasajilin: ['rasagiline'], fenelzin: ['phenelzine'],
  fentanil: ['fentanyl'], morfin: ['morphine'], kodein: ['codeine'], oksikodon: ['oxycodone'],
  hidrokodon: ['hydrocodone'], metadon: ['methadone'], buprenorfin: ['buprenorphine'],
  klonazepam: ['clonazepam'], klordiazepoksit: ['chlordiazepoxide'],
  nitrogliserin: ['nitroglycerin'], 'glyceryl trinitrate': ['nitroglycerin'],
  isosorbide: ['isosorbide mononitrate'], izosorbid: ['isosorbide mononitrate'],
  'izosorbid dinitrat': ['isosorbide dinitrate'], 'izosorbid mononitrat': ['isosorbide mononitrate'],
  klaritromisin: ['clarithromycin'], eritromisin: ['erythromycin'], azitromisin: ['azithromycin'],
  roksitromisin: ['roxithromycin'], flukonazol: ['fluconazole'], itrakonazol: ['itraconazole'],
  ketokonazol: ['ketoconazole'], vorikonazol: ['voriconazole'],
  lizinopril: ['lisinopril'], kaptopril: ['captopril'], kandesartan: ['candesartan'],
  spironolakton: ['spironolactone'], eplerenon: ['eplerenone'], amilorid: ['amiloride'], triamteren: ['triamterene'],
  potassium: ['potassium chloride'], potasyum: ['potassium chloride'], 'potasyum klorur': ['potassium chloride'],
  'potasyum sitrat': ['potassium citrate'], kalium: ['potassium chloride'],
  hidroklorotiyazid: ['hydrochlorothiazide'], furosemid: ['furosemide'], torasemid: ['torsemide'], indapamid: ['indapamide'],
  lityum: ['lithium'], 'lithium carbonate': ['lithium'], 'lityum karbonat': ['lithium'],
  alkol: ['alcohol'], etanol: ['alcohol'], ethanol: ['alcohol'],
  metotreksat: ['methotrexate'], amiodaron: ['amiodarone'], metronidazol: ['metronidazole'],
  teofilin: ['theophylline'], omeprazol: ['omeprazole'], esomeprazol: ['esomeprazole'],
  pantoprazol: ['pantoprazole'], lansoprazol: ['lansoprazole'], amlodipin: ['amlodipine'],
  siprofloksasin: ['ciprofloxacin'], albuterol: ['salbutamol'], salbutamol: ['salbutamol'],
  levotiroksin: ['levothyroxine'], diltiazem: ['diltiazem'],

  // --- US brands / generics from constants/medications.ts ---
  Abilify: ['aripiprazole'], Advil: ['ibuprofen'], Aleve: ['naproxen'], Allegra: ['fexofenadine'],
  Ambien: ['zolpidem'], Amoxicillin: ['amoxicillin'], Ativan: ['lorazepam'], Azithromycin: ['azithromycin'],
  Baclofen: ['baclofen'], Bactrim: ['sulfamethoxazole', 'trimethoprim'], Benadryl: ['diphenhydramine'],
  Buspirone: ['buspirone'], Carvedilol: ['carvedilol'], Celebrex: ['celecoxib'], Celexa: ['citalopram'],
  Cialis: ['tadalafil'], Ciprofloxacin: ['ciprofloxacin'], Claritin: ['loratadine'], Clindamycin: ['clindamycin'],
  Crestor: ['rosuvastatin'], Cyclobenzaprine: ['cyclobenzaprine'], Cymbalta: ['duloxetine'],
  Dexamethasone: ['dexamethasone'], Digoxin: ['digoxin'], Doxycycline: ['doxycycline'],
  Effexor: ['venlafaxine'], Eliquis: ['apixaban'], Estradiol: ['estradiol'], Ezetimibe: ['ezetimibe'],
  Famotidine: ['famotidine'], Farxiga: ['dapagliflozin'], Fenofibrate: ['fenofibrate'], Flexeril: ['cyclobenzaprine'],
  Flonase: ['fluticasone'], Fluticasone: ['fluticasone'], 'Folic Acid': ['folic acid'], Gabapentin: ['gabapentin'],
  Glimepiride: ['glimepiride'], Glipizide: ['glipizide'], Glucophage: ['metformin'], Guanfacine: ['guanfacine'],
  Humalog: ['insulin lispro'], Hydralazine: ['hydralazine'], Hydroxyzine: ['hydroxyzine'], Imitrex: ['sumatriptan'],
  Insulin: ['insulin'], Invokana: ['canagliflozin'], Januvia: ['sitagliptin'], Jardiance: ['empagliflozin'],
  Jentadueto: ['linagliptin', 'metformin'], Keflex: ['cefalexin'], Kenalog: ['triamcinolone'], Keppra: ['levetiracetam'],
  Klonopin: ['clonazepam'], Lantus: ['insulin glargine'], Lasix: ['furosemide'], Latanoprost: ['latanoprost'],
  Lexapro: ['escitalopram'], Lipitor: ['atorvastatin'], Loratadine: ['loratadine'], Lotrel: ['amlodipine', 'benazepril'],
  Lyrica: ['pregabalin'], Meclizine: ['meclizine'], Methylprednisolone: ['methylprednisolone'], Metoprolol: ['metoprolol'],
  Mirtazapine: ['mirtazapine'], Mobic: ['meloxicam'], Motrin: ['ibuprofen'], Mupirocin: ['mupirocin'],
  Nasonex: ['mometasone'], Neurontin: ['gabapentin'], Nexium: ['esomeprazole'], Niacin: ['niacin'],
  Nifedipine: ['nifedipine'], Nitrofurantoin: ['nitrofurantoin'], Norvasc: ['amlodipine'], Novolog: ['insulin aspart'],
  Olanzapine: ['olanzapine'], Ondansetron: ['ondansetron'], Paxil: ['paroxetine'],
  Percocet: ['oxycodone', 'paracetamol'], Phenobarbital: ['phenobarbital'], Phentermine: ['phentermine'],
  Plavix: ['clopidogrel'], Prednisone: ['prednisone'], Prilosec: ['omeprazole'], Proair: ['salbutamol'],
  Propranolol: ['propranolol'], Prozac: ['fluoxetine'], Quetiapine: ['quetiapine'], Ranitidine: ['ranitidine'],
  Relpax: ['eletriptan'], Restoril: ['temazepam'], Risperdal: ['risperidone'], Ritalin: ['methylphenidate'],
  Rocaltrol: ['calcitriol'], Seroquel: ['quetiapine'], Singulair: ['montelukast'], Spiriva: ['tiotropium'],
  Strattera: ['atomoxetine'], Synthroid: ['levothyroxine'], Tamsulosin: ['tamsulosin'], Topiramate: ['topiramate'],
  Trazodone: ['trazodone'], Tretinoin: ['tretinoin'], Triamcinolone: ['triamcinolone'], Valium: ['diazepam'],
  Ventolin: ['salbutamol'], Verapamil: ['verapamil'], Viagra: ['sildenafil'], Vicodin: ['hydrocodone', 'paracetamol'],
  'Vitamin D': ['cholecalciferol'], Vyvanse: ['lisdexamfetamine'], Wellbutrin: ['bupropion'], Xanax: ['alprazolam'],
  Xarelto: ['rivaroxaban'], Xyzal: ['levocetirizine'], Zantac: ['ranitidine'], Zestril: ['lisinopril'],
  Zetia: ['ezetimibe'], Zithromax: ['azithromycin'], Zocor: ['simvastatin'], Zofran: ['ondansetron'],
  Zoloft: ['sertraline'], Zolpidem: ['zolpidem'], Zosyn: ['piperacillin', 'tazobactam'],
  Zubsolv: ['buprenorphine', 'naloxone'], Zyrtec: ['cetirizine'],

  // --- Turkish brands from constants/medications.ts ---
  Aerius: ['desloratadine'], Alfasilin: ['ampicillin'], Amaryl: ['glimepiride'],
  Amoklavin: ['amoxicillin', 'clavulanic acid'], Antepsin: ['sucralfate'], Apranax: ['naproxen'],
  Arveles: ['dexketoprofen'], Atacand: ['candesartan'], Ator: ['atorvastatin'],
  Augmentin: ['amoxicillin', 'clavulanic acid'], Avamys: ['fluticasone'], Avelox: ['moxifloxacin'],
  Azitro: ['azithromycin'], 'Beloc ZOK': ['metoprolol'], 'Benexol B12': ['thiamine', 'pyridoxine', 'cyanocobalamin'],
  Buscopan: ['hyoscine butylbromide'], Calcimax: ['calcium carbonate', 'cholecalciferol'], Cardura: ['doxazosin'],
  Cataflam: ['diclofenac'], Ceclor: ['cefaclor'], Cefaks: ['cefuroxime'], Cipro: ['ciprofloxacin'],
  Cipralex: ['escitalopram'], 'Co-Diovan': ['valsartan', 'hydrochlorothiazide'], Concor: ['bisoprolol'],
  Coraspin: ['aspirin'], Coveram: ['perindopril', 'amlodipine'], Daflon: ['diosmin', 'hesperidin'],
  Dekort: ['dexamethasone'], Delix: ['ramipril'], Desal: ['furosemide'], 'Devit-3': ['cholecalciferol'],
  Diaformin: ['metformin'], Diamicron: ['gliclazide'], Dicetel: ['pinaverium'], Dikloron: ['diclofenac'],
  Diklomec: ['diclofenac'], Diltizem: ['diltiazem'], Dolorex: ['diclofenac'], Doxium: ['calcium dobesilate'],
  Duocid: ['ampicillin', 'sulbactam'], Ecopirin: ['aspirin'], Efexor: ['venlafaxine'], Enapril: ['enalapril'],
  'Etol Fort': ['etodolac'], Euthyrox: ['levothyroxine'], Excedrin: ['aspirin', 'paracetamol', 'caffeine'],
  Famodin: ['famotidine'], Flagyl: ['metronidazole'], Flixotide: ['fluticasone'], Flucan: ['fluconazole'],
  Foster: ['beclometasone', 'formoterol'], Gaviscon: ['sodium alginate', 'sodium bicarbonate', 'calcium carbonate'],
  Gliben: ['glibenclamide'], Glifor: ['metformin'], Glucantime: ['meglumine antimoniate'],
  Gripin: ['paracetamol', 'caffeine', 'chlorphenamine'], Haldol: ['haloperidol'], Hametan: ['hamamelis'],
  Hyzaar: ['losartan', 'hydrochlorothiazide'], Karvezide: ['irbesartan', 'hydrochlorothiazide'],
  Klamer: ['clarithromycin'], Lansor: ['lansoprazole'], Largopen: ['amoxicillin'], Laroxyl: ['amitriptyline'],
  Levotiron: ['levothyroxine'], Lustral: ['sertraline'], Macrol: ['clarithromycin'], Madecassol: ['centella asiatica'],
  Majezik: ['flurbiprofen'], Matofin: ['metformin'], Melox: ['meloxicam'], Metpamid: ['metoclopramide'],
  Micardis: ['telmisartan'], Minoset: ['paracetamol'], Monodox: ['doxycycline'], Motilium: ['domperidone'],
  Muscoril: ['thiocolchicoside'], Naprosyn: ['naproxen'], Nazoster: ['mometasone'], Novalgin: ['metamizole'],
  Nurofen: ['ibuprofen'], Oceral: ['oxiconazole'], Osteocare: ['calcium carbonate', 'cholecalciferol'],
  Panadol: ['paracetamol'], Panto: ['pantoprazole'], Parol: ['paracetamol'], Passiflora: ['passiflora'],
  Paxera: ['paroxetine'], Pharmaton: ['multivitamin'], Ponstan: ['mefenamic acid'], Pulcet: ['pantoprazole'],
  Pulmicort: ['budesonide'], Rennie: ['calcium carbonate', 'magnesium carbonate'], Rivotril: ['clonazepam'],
  Rosuvas: ['rosuvastatin'], Rulid: ['roxithromycin'], Rytmonorm: ['propafenone'], Saneloc: ['metoprolol'],
  Serequel: ['quetiapine'], Siprobel: ['ciprofloxacin'], Solgar: ['multivitamin'], Supradyn: ['multivitamin'],
  Symbicort: ['budesonide', 'formoterol'], Talcid: ['hydrotalcite'], Tetradox: ['doxycycline'],
  Tilcotil: ['tenoxicam'], Tolvon: ['mianserin'], Travocort: ['isoconazole', 'diflucortolone'],
  Tylolhot: ['paracetamol', 'pheniramine', 'phenylephrine'], Vasoxen: ['nebivolol'],
  Vermidon: ['paracetamol', 'caffeine'], Vicks: ['menthol', 'camphor'], Voltaren: ['diclofenac'],
  Zaditen: ['ketotifen'], Zarator: ['atorvastatin'], Zinnat: ['cefuroxime'],

  // --- other common Turkish-market brands ---
  Coumadin: ['warfarin'], Orfarin: ['warfarin'], Pradaxa: ['dabigatran'], Lixiana: ['edoxaban'],
  Brilinta: ['ticagrelor'], Efient: ['prasugrel'], Karum: ['clopidogrel'], Opirin: ['aspirin'],
  Aspirin: ['aspirin'], 'Aspirin Protect': ['aspirin'], Brufen: ['ibuprofen'], Pedifen: ['ibuprofen'],
  Calpol: ['paracetamol'], Tamol: ['paracetamol'], Froben: ['flurbiprofen'],
  Diclomec: ['diclofenac'], Dexday: ['dexketoprofen'], Levitra: ['vardenafil'],
  Isordil: ['isosorbide dinitrate'], Monoket: ['isosorbide mononitrate'], Nitrolingual: ['nitroglycerin'],
  Cordarone: ['amiodarone'], Diflucan: ['fluconazole'], Sporanox: ['itraconazole'], Klacid: ['clarithromycin'],
  Zitromax: ['azithromycin'], Contramal: ['tramadol'], Aldactone: ['spironolactone'], Losec: ['omeprazole'],
  Coversyl: ['perindopril'], Diovan: ['valsartan'], Cozaar: ['losartan'], Talofilin: ['theophylline'],
  Lithuril: ['lithium'], Aurorix: ['moclobemide'], Azilect: ['rasagiline'], Seroxat: ['paroxetine'],
  Durogesic: ['fentanyl'], Metoject: ['methotrexate'], Cipram: ['citalopram'], Desyrel: ['trazodone'],
};

// ============================================================================
// Rules
// ============================================================================

const SUFFIX_TR = ' Doktorunuza veya eczacınıza danışın.';
const SUFFIX_EN = ' Talk to your doctor or pharmacist.';
const r = (a: Matcher, b: Matcher, severity: InteractionSeverity, tr: string, en: string, spacingHours?: number): InteractionRule =>
  ({ a, b, severity, tr: tr + SUFFIX_TR, en: en + SUFFIX_EN, ...(spacingHours !== undefined ? { spacingHours } : {}) });
/** spacingHours value for rules where taking the doses hours apart does not help. */
const NO_SPACING = 0;

const BLEED_TR = 'Birlikte kullanıldığında kanama riski artabilir.';
const BLEED_EN = 'Taking these together may increase the risk of bleeding.';
const SEROTONIN_TR = 'Birlikte kullanıldığında serotonin sendromu (ateş, titreme, huzursuzluk) riski artabilir.';
const SEROTONIN_EN = 'Taking these together may increase the risk of serotonin syndrome (fever, shaking, agitation).';
const K_TR = 'Birlikte kullanıldığında kandaki potasyum düzeyi tehlikeli şekilde yükselebilir.';
const K_EN = 'Taking these together may raise blood potassium to dangerous levels.';
const LI_TR = 'Bu ilaç kandaki lityum düzeyini yükseltebilir ve lityum zehirlenmesine yol açabilir.';
const LI_EN = 'This medicine may raise lithium levels in the blood and lead to lithium toxicity.';
const MUSCLE_TR = 'Bu ilaç kolesterol ilacının kandaki düzeyini artırarak ciddi kas hasarı riskini yükseltebilir.';
const MUSCLE_EN = 'This medicine may raise the level of the cholesterol medicine and increase the risk of serious muscle damage.';

const CALCIUM = ['calcium', 'calcium carbonate', 'calcium citrate'];
const IRON = ['iron', 'ferrous sulfate', 'ferrous fumarate', 'ferric hydroxide polymaltose'];
const ANTACID = ['magnesium', 'magnesium carbonate', 'magnesium hydroxide', 'magnesium oxide', 'aluminium hydroxide', 'hydrotalcite'];
const QUINOLONE = ['ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'ofloxacin'];
const TETRACYCLINE = ['doxycycline', 'tetracycline', 'minocycline'];

/**
 * Order matters only for ties: the most severe matching rule wins,
 * and among equal severities the earlier (more specific) rule wins.
 */
export const RULES: InteractionRule[] = [
  // --- contraindicated ---
  r('@pde5', '@nitrate', 'contraindicated',
    'Bu iki ilaç birlikte kullanılmamalıdır; tansiyonda ani ve tehlikeli düşüşe yol açabilir.',
    'These medicines should not be taken together; they can cause a sudden, dangerous drop in blood pressure.'),
  r('@serotonergic', '@maoi', 'contraindicated', SEROTONIN_TR + ' Bu iki ilaç genellikle birlikte kullanılmaz.',
    SEROTONIN_EN + ' These are generally not used together.'),

  // --- substance-specific (legacy list + additions) ---
  r('aspirin', 'warfarin', 'major', 'Aspirin, varfarinin kan sulandırıcı etkisini artırır; ciddi kanama riski yükselir.',
    'Aspirin adds to the blood-thinning effect of warfarin and raises the risk of serious bleeding.'),
  r('aspirin', 'ibuprofen', 'major', BLEED_TR + ' İbuprofen, aspirinin kalbi koruyucu etkisini de azaltabilir.',
    BLEED_EN + ' Ibuprofen may also reduce the heart-protective effect of aspirin.'),
  r('warfarin', ['metronidazole', 'amiodarone'], 'major',
    'Bu ilaç varfarinin etkisini belirgin şekilde artırabilir; kanama riski yükselir.',
    'This medicine can strongly increase the effect of warfarin and raise the risk of bleeding.'),
  r('warfarin', 'paracetamol', 'moderate', 'Düzenli parasetamol kullanımı varfarinin etkisini (INR) artırabilir.',
    'Regular use of paracetamol may increase the effect of warfarin (INR).', NO_SPACING),
  r('simvastatin', 'amiodarone', 'major', MUSCLE_TR, MUSCLE_EN),
  r('atorvastatin', 'amiodarone', 'moderate', MUSCLE_TR, MUSCLE_EN, NO_SPACING),
  r('simvastatin', 'amlodipine', 'moderate', 'Amlodipin simvastatin düzeyini artırabilir; kas ağrısı ve kas hasarı riski yükselebilir.',
    'Amlodipine may raise simvastatin levels and increase the risk of muscle pain or damage.', NO_SPACING),
  r('methotrexate', '@nsaid', 'major', 'Ağrı kesici (NSAİİ), metotreksatın vücuttan atılmasını azaltarak zehirli düzeylere çıkmasına yol açabilir.',
    'NSAID pain relievers may slow the removal of methotrexate and lead to toxic levels.'),
  r('ciprofloxacin', 'theophylline', 'major', 'Siprofloksasin teofilin düzeyini artırabilir; nöbet ve kalp ritmi sorunları görülebilir.',
    'Ciprofloxacin may raise theophylline levels and cause seizures or heart rhythm problems.'),
  r('@ssri', 'tramadol', 'major', SEROTONIN_TR + ' Nöbet riski de artabilir.', SEROTONIN_EN + ' Seizure risk may also increase.'),
  r('clopidogrel', ['omeprazole', 'esomeprazole'], 'moderate', 'Bu mide ilacı klopidogrelin etkisini azaltabilir.',
    'This stomach medicine may reduce the effect of clopidogrel.', NO_SPACING),
  r('metformin', 'alcohol', 'major', 'Alkol, metformin ile birlikte nadir ama ciddi bir durum olan laktik asidoz riskini artırır.',
    'Alcohol with metformin increases the risk of lactic acidosis, a rare but serious condition.'),
  r('paracetamol', ['aspirin', 'flurbiprofen'], 'moderate',
    'Genellikle birlikte kullanılabilirler; ancak uzun süreli birlikte kullanım mide ve karaciğeri zorlayabilir.',
    'Usually taken together safely, but long-term combined use may strain the stomach and liver.', NO_SPACING),

  // --- class rules ---
  r('@anticoagulant_vka', ['@nsaid', '@antiplatelet'], 'major', BLEED_TR, BLEED_EN),
  r('@anticoagulant_vka', '@azole', 'major', 'Mantar ilacı varfarinin etkisini belirgin şekilde artırabilir; kanama riski yükselir.',
    'This antifungal can strongly increase the effect of warfarin and raise the risk of bleeding.'),
  r('@anticoagulant_vka', '@macrolide', 'moderate', 'Bu antibiyotik varfarinin etkisini artırabilir; kanama riski yükselebilir.',
    'This antibiotic may increase the effect of warfarin and the risk of bleeding.', NO_SPACING),
  r('@doac', ['@nsaid', '@antiplatelet'], 'major', BLEED_TR, BLEED_EN),
  r('@anticoagulant', '@anticoagulant', 'major', 'İki kan sulandırıcının birlikte kullanımı ciddi kanama riski taşır.',
    'Using two blood thinners together carries a high risk of serious bleeding.'),
  r('@antiplatelet', '@antiplatelet', 'moderate', BLEED_TR + ' Bu ikili ancak doktor gözetiminde kullanılır.',
    BLEED_EN + ' This combination is only used under medical supervision.', NO_SPACING),
  r('@nsaid', '@nsaid', 'major', 'İki ağrı kesicinin (NSAİİ) birlikte kullanımı mide kanaması, ülser ve böbrek hasarı riskini artırır.',
    'Taking two NSAID pain relievers together increases the risk of stomach bleeding, ulcers and kidney damage.'),
  r('@benzodiazepine', '@opioid', 'major', 'Birlikte kullanıldığında aşırı uyku hâli, solunumun yavaşlaması ve bilinç kaybı görülebilir.',
    'Taking these together may cause severe drowsiness, slowed breathing and loss of consciousness.'),
  r('@serotonergic', '@serotonergic', 'moderate', SEROTONIN_TR, SEROTONIN_EN, NO_SPACING),
  r('lithium', ['@nsaid', '@ace_inhibitor', '@arb', '@diuretic'], 'major', LI_TR, LI_EN),
  r('@potassium_sparing', ['@ace_inhibitor', '@arb', '@potassium'], 'major', K_TR, K_EN),
  r('@ace_inhibitor', '@potassium', 'major', K_TR, K_EN),
  r('@arb', '@potassium', 'moderate', K_TR, K_EN, NO_SPACING),
  r('@statin_cyp3a4', ['@macrolide_cyp3a4', '@azole'], 'major', MUSCLE_TR, MUSCLE_EN),

  // --- absorption clashes: taking the doses hours apart avoids them (spacingHours) ---
  r('levothyroxine', [...CALCIUM, ...IRON, ...ANTACID], 'moderate',
    'Kalsiyum, demir ve mide ilaçları (antasit) tiroid ilacının emilimini azaltır. İkisinin arasına en az 4 saat koyun.',
    'Calcium, iron and antacids reduce the absorption of thyroid medicine. Take them at least 4 hours apart.', 4),
  r(QUINOLONE, [...CALCIUM, ...IRON, ...ANTACID, 'zinc'], 'moderate',
    'Kalsiyum, demir, magnezyum ve çinko bu antibiyotiğin emilimini azaltır. Antibiyotiği bunlardan en az 2 saat önce ya da 6 saat sonra alın.',
    'Calcium, iron, magnesium and zinc reduce the absorption of this antibiotic. Take the antibiotic at least 2 hours before or 6 hours after them.', 6),
  r(TETRACYCLINE, [...CALCIUM, ...IRON, ...ANTACID, 'zinc'], 'moderate',
    'Kalsiyum, demir, magnezyum ve çinko bu antibiyotiğin emilimini azaltır. İkisinin arasına en az 3 saat koyun.',
    'Calcium, iron, magnesium and zinc reduce the absorption of this antibiotic. Take them at least 3 hours apart.', 3),
];

// ============================================================================
// Normalization & lookup
// ============================================================================

/** Dose / unit / dosage-form tokens stripped from names. */
const NOISE = new Set([
  'mg', 'mcg', 'ug', 'g', 'gr', 'ml', 'iu', 'ui', 'tb', 'tab', 'tablet', 'tablets',
  'film', 'kapli', 'coated', 'kapsul', 'capsule', 'capsules', 'cap', 'caps', 'efervesan', 'effervescent',
  'surup', 'syrup', 'damla', 'drops', 'ampul', 'flakon', 'krem', 'cream', 'jel', 'gel', 'pomad', 'merhem',
  'sprey', 'spray', 'sase', 'sachet', 'adet', 'x',
]);

/** "Coraspin 300mg Tablet" -> "coraspin"; "İBUPROFEN" -> "ibuprofen"; "Co-Diovan" -> "co diovan". */
export function normalizeDrugName(name: string): string {
  return name
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(t => t && !NOISE.has(t) && !/^\d+(mg|mcg|ug|g|ml|iu)?$/.test(t))
    .join(' ');
}

const NAME_INDEX = new Map<string, string[]>();
for (const ing of Object.keys(INGREDIENT_CLASSES)) NAME_INDEX.set(normalizeDrugName(ing), [ing]);
for (const [name, ings] of Object.entries(NAME_TO_INGREDIENTS)) {
  NAME_INDEX.set(normalizeDrugName(name), ings);
  for (const ing of ings) if (!NAME_INDEX.has(normalizeDrugName(ing))) NAME_INDEX.set(normalizeDrugName(ing), [ing]);
}

/** Active ingredients for a free-text name, or null if unknown. Longest word-prefix match wins. */
export function resolveIngredients(name: string): string[] | null {
  const words = normalizeDrugName(name).split(' ').filter(Boolean);
  for (let n = words.length; n > 0; n--) {
    const hit = NAME_INDEX.get(words.slice(0, n).join(' '));
    if (hit) return hit;
  }
  return null;
}

const matches = (ing: string, m: Matcher): boolean =>
  Array.isArray(m) ? m.some(x => matches(ing, x))
    : m.startsWith('@') ? (INGREDIENT_CLASSES[ing] ?? []).includes(m.slice(1))
    : ing === m;

/** Symmetric by construction. */
export const ruleMatches = (rule: InteractionRule, x: string, y: string): boolean =>
  (matches(x, rule.a) && matches(y, rule.b)) || (matches(x, rule.b) && matches(y, rule.a));

const RANK: Record<InteractionSeverity, number> = { contraindicated: 0, major: 1, moderate: 2 };

function ingredientPair(x: string, y: string): { severity: InteractionSeverity; tr: string; en: string; spacingHours?: number } | null {
  if (x === y) {
    return {
      severity: 'major',
      tr: `Her iki ilaç da aynı etken maddeyi (${x}) içeriyor; birlikte almak doz aşımına yol açabilir.${SUFFIX_TR}`,
      en: `Both medicines contain the same active ingredient (${x}); taking both may lead to an overdose.${SUFFIX_EN}`,
    };
  }
  let best: InteractionRule | null = null;
  for (const rule of RULES) {
    if (ruleMatches(rule, x, y) && (!best || RANK[rule.severity] < RANK[best.severity])) best = rule;
  }
  return best;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Check a new medication against the user's existing ones.
 * Returns at most one (the most severe) interaction per existing medication,
 * sorted contraindicated -> major -> moderate.
 */
export function checkInteractions(newMedName: string, existingMedNames: string[]): InteractionCheckResult {
  const unrecognized: string[] = [];
  const resolve = (n: string) => {
    const ings = resolveIngredients(n);
    if (!ings && !unrecognized.includes(n)) unrecognized.push(n);
    return ings;
  };

  const interactions: InteractionHit[] = [];
  const newIngs = newMedName.trim() ? resolve(newMedName) : null;

  for (const other of existingMedNames) {
    if (!other.trim()) continue;
    const otherIngs = resolve(other);
    if (!newIngs || !otherIngs) continue;
    let best: ReturnType<typeof ingredientPair> = null;
    for (const x of newIngs) for (const y of otherIngs) {
      const hit = ingredientPair(x, y);
      if (hit && (!best || RANK[hit.severity] < RANK[best.severity])) best = hit;
    }
    if (best) interactions.push({ with: other, severity: best.severity, messageTr: best.tr, messageEn: best.en, spacingHours: best.spacingHours });
  }

  interactions.sort((p, q) => RANK[p.severity] - RANK[q.severity]);
  return { interactions, unrecognized, disclaimerKey: 'interactions.disclaimer' };
}

// ============================================================================
// Legacy API (kept so AddEditMedication.tsx compiles until it is migrated)
// ============================================================================

/** @deprecated use checkInteractions */
export interface DrugInteraction {
  severity: InteractionSeverity;
  description: string;
  messageTr: string;
  drug1Name: string;
  drug2Name: string;
}

export const drugInteractionService = {
  /** @deprecated use checkInteractions(newMedName, existingMedNames) */
  async checkInteractionsByName(drugNames: string[]): Promise<DrugInteraction[]> {
    const names = [...new Set(drugNames.map(n => n.trim()).filter(Boolean))];
    const out: DrugInteraction[] = [];
    for (let j = 1; j < names.length; j++) {
      for (const hit of checkInteractions(names[j], names.slice(0, j)).interactions) {
        out.push({ severity: hit.severity, description: hit.messageEn, messageTr: hit.messageTr, drug1Name: hit.with, drug2Name: names[j] });
      }
    }
    return out;
  },
};

// ============================================================================
// Dose spacing (used by services/interactionSchedule)
// ============================================================================

/** Generic names for the absorption-clash rules above (brands are in NAME_TO_INGREDIENTS). */
const SPACING_NAMES: Record<string, string[]> = {
  kalsiyum: ['calcium'], calcium: ['calcium'], 'kalsiyum karbonat': ['calcium carbonate'], 'calcium carbonate': ['calcium carbonate'],
  demir: ['iron'], iron: ['iron'], 'demir sulfat': ['ferrous sulfate'], 'ferrous sulfate': ['ferrous sulfate'],
  'ferro sanol': ['ferrous sulfate'], maltofer: ['ferric hydroxide polymaltose'],
  magnezyum: ['magnesium'], magnesium: ['magnesium'], antasit: ['aluminium hydroxide', 'magnesium hydroxide'],
  antacid: ['aluminium hydroxide', 'magnesium hydroxide'], cinko: ['zinc'], zinc: ['zinc'],
  levofloksasin: ['levofloxacin'], levofloxacin: ['levofloxacin'], tavanic: ['levofloxacin'],
  moksifloksasin: ['moxifloxacin'], ofloksasin: ['ofloxacin'], ofloxacin: ['ofloxacin'],
  doksisiklin: ['doxycycline'], tetrasiklin: ['tetracycline'], tetracycline: ['tetracycline'],
  minosiklin: ['minocycline'], minocycline: ['minocycline'],
};
for (const ing of [...CALCIUM, ...IRON, ...ANTACID, ...QUINOLONE, ...TETRACYCLINE, 'zinc']) SPACING_NAMES[ing] ??= [ing];
for (const [name, ings] of Object.entries(SPACING_NAMES)) {
  const key = normalizeDrugName(name);
  if (!NAME_INDEX.has(key)) NAME_INDEX.set(key, ings);
}

/** Moderate interactions with no known spacing: keep doses at least this far apart. */
export const DEFAULT_SPACING_HOURS = 2;

/**
 * Hours to keep between two interacting doses, or null when timing does not help
 * (contraindicated, or a systemic effect such as warfarin + aspirin bleeding risk).
 */
export function spacingFor(hit: Pick<InteractionHit, 'severity' | 'spacingHours'>): number | null {
  if (hit.severity === 'contraindicated') return null;
  if (hit.spacingHours !== undefined) return hit.spacingHours > 0 ? hit.spacingHours : null;
  return hit.severity === 'moderate' ? DEFAULT_SPACING_HOURS : null;
}
