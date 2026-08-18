"""
train_sentiment_model.py

Trains ONE model that outputs 3 classes -- "positive", "neutral", or
"negative" -- used by classify_sentiment() in api/index.py for two things:
  1. Populating sentiment_label / sentiment_score on every comment.
  2. Deriving is_flagged (label == "negative" AND score >= threshold),
     replacing the old separate binary flagged/not-flagged model.

Data sources, merged:
  1. BARANGAY_SEED_DATA -- your hand-written, barangay-specific examples,
     now labeled with 3 classes instead of binary.
  2. ccosme/SentiTaglishProductsAndServices -- free, CC-BY-4.0, 10,510-row
     Taglish dataset, manually labeled by 3 human annotators.
     https://huggingface.co/datasets/ccosme/SentiTaglishProductsAndServices
     Original encoding: 1=Negative, 2=Neutral, 3=Positive, 4=Mixed.
     Mixed is folded into "negative" here (a mixed comment usually has a
     negative component worth surfacing) -- there's no "mixed" bucket in
     your comments table's sentiment_label CHECK constraint.

Run this locally (NOT on Vercel):
    pip install scikit-learn datasets pandas
    python train_sentiment_model.py

Produces:
    vectorizer.pkl
    sentiment_model.pkl

Copy BOTH into your api/ folder (replacing the old ones) and deploy.
"""

import pickle
from datasets import load_dataset
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score

# ============================================================
# 1. YOUR BARANGAY-SPECIFIC SEED DATA
#    label: "positive" / "neutral" / "negative"
# ============================================================
BARANGAY_SEED_DATA = [
    # ---- Positive: praise, thanks, enthusiasm ----
    ("Salamat po sa inyong serbisyo, malaking tulong po ito sa amin.", "positive"),
    ("Ang galing ng proyektong ito, sana po magpatuloy.", "positive"),
    ("Maraming salamat sa mga SK officials sa pagtulong sa aming barangay.", "positive"),
    ("Napakaganda ng inisyatibo na ito para sa kabataan.", "positive"),
    ("Sana po magkaroon pa ng ganitong programa sa susunod na taon.", "positive"),
    ("Nakakatuwa naman itong proyekto, keep it up!", "positive"),
    ("Very helpful po ang document na ito, thank you.", "positive"),
    ("Good job sa mga SK officials, transparent talaga kayo.", "positive"),
    ("Ang linaw po ng report, madaling maintindihan.", "positive"),
    ("Sobrang laking tulong nito sa aming mga magulang.", "positive"),
    ("Panalo ang programang ito para sa mga kabataan.", "positive"),
    ("Grabe ang dami niyong natulungan, proud ako sa inyo.", "positive"),
    ("Very informative po, salamat sa pag-post nito.", "positive"),
    ("Sana lahat ng barangay ganito ka-transparent.", "positive"),
    ("Nice initiative, mas lalo pa sana kayong gumaling.", "positive"),
    ("Ito yung dapat gawin ng lahat ng SK, salute!", "positive"),
    ("Malinaw po ang budget report, thank you sa transparency.", "positive"),
    ("Kudos sa pamunuan, epektibo ang programa ninyo.", "positive"),
    ("Salamat sa update, alam namin kung saan napupunta ang budget.", "positive"),
    ("Napakalaking tulong nito sa kabataan ng barangay namin.", "positive"),
    ("Sana magpatuloy pa ang mga ganitong proyekto.", "positive"),
    ("Astig, dapat talaga ma-implement ito agad.", "positive"),
    ("Well done sa taong nag-organize nito.", "positive"),
    ("Ang bait niyo talaga, thank you sa serbisyo.", "positive"),
    ("Solid ang report, walang mali dito.", "positive"),
    ("Congrats sa successful event kahapon.", "positive"),
    ("Please continue po ang ganitong klaseng transparency.", "positive"),
    ("Sulit ang budget na ginamit, maayos ang implementation.", "positive"),
    ("Thank you po sa pagbibigay ng detalyadong impormasyon.", "positive"),
    ("Ang husay talaga ng mga kabataang lider dito.", "positive"),

    # ---- Neutral: informational questions, logistics, no clear sentiment ----
    ("Kailan po ang susunod na event? Sasali kami ulit.", "neutral"),
    ("Pwede po ba malaman kung saan gagamitin ang budget na ito?", "neutral"),
    ("Ano po ang requirements para makasali sa programang ito?", "neutral"),
    ("Saan po pwede kumuha ng registration form?", "neutral"),
    ("Magandang umaga po, gusto ko lang po itanong ang schedule.", "neutral"),
    ("Puwede po malaman ang venue ng susunod na aktibidad?", "neutral"),

    # ---- Negative: complaints, toxic, accusatory ----
    ("Wala kayong ginagawa, puro pangako lang.", "negative"),
    ("Sayang lang ang budget dito, walang kwenta ito.", "negative"),
    ("Bobo talaga ang mga opisyal dito, wala silang naiintindihan.", "negative"),
    ("Kadiring proyekto ito, puro sipsip lang kayo sa mayor.", "negative"),
    ("Wala kwentang serbisyo, ang bagal niyo pa magrespond.", "negative"),
    ("Panay kayo daldal, walang aksyon.", "negative"),
    ("Ang panget ng ginawa niyo, sayang ang pera ng bayan.", "negative"),
    ("Puro kalokohan itong mga proyektong ito.", "negative"),
    ("Gago talaga itong mga opisyal, wala kayong silbi.", "negative"),
    ("Nakakainis kayo, sabi niyo tulong pero wala namang natulungan.", "negative"),
    ("Kawawa naman kami, pinapabayaan lang ng SK.", "negative"),
    ("Ang tanga tanga ng plano niyo, di kayo marunong mag-isip.", "negative"),
    ("Puro sipsip lang kayo, walang kwentang lider.", "negative"),
    ("Nakaka-inis kayo, puro salita walang gawa.", "negative"),
    ("Sino ba pumayag dito, ang pangit ng idea.", "negative"),
    ("Kayo lang naman ang nakikinabang dito, mga corrupt.", "negative"),
    ("Bulok ang serbisyo niyo, wala kayong ginagawa para sa amin.", "negative"),
    ("Ayaw ko sa ginagawa niyo, sayang lang ang oras namin.", "negative"),
    ("Grabe ang katangahan ng mga desisyon niyo dito.", "negative"),
    ("Puro kayo pakitang tao, wala namang tunay na tulong.", "negative"),
    ("Wala kang alam, huwag ka nang mag-post ng ganyan.", "negative"),
    ("Sobrang cheap ng ginawa niyo, nakakahiya.", "negative"),
    ("Puro daya itong proseso niyo, hindi fair sa amin.", "negative"),
    ("Yuck, ang panget talaga ng plano niyo dito.", "negative"),
    ("Corrupt kayo, alam naming pinagkakakitaan niyo ito.", "negative"),
    ("Wala kayong pakialam sa amin, puro sarili niyo lang inisip.", "negative"),
    ("Hindi ko matanggap ang katangahan ng ginawa niyo.", "negative"),
    ("Sayang ang tax namin dito, walang resulta.", "negative"),
    ("Puro kasinungalingan ang laman ng report na ito.", "negative"),
    ("Nakakadiri ang atityud niyo sa mga residente.", "negative"),
    ("Walang silbi itong mga SK officials, tanggalin niyo na sila.", "negative"),
    ("Puro palusot, wala kayong tino.", "negative"),
    ("Nagagalit ako sa kapabayaan niyong ipinapakita.", "negative"),
    ("Grabe ka-duwag, ayaw sagutin ang mga tanong namin.", "negative"),
    ("Tuta lang kayo ng mga politiko, wala kayong sariling pananaw.", "negative"),
    ("Bobo", "negative"),
    ("Tanga", "negative"),
]

# ============================================================
# 2. DOWNLOAD + REMAP: ccosme/SentiTaglishProductsAndServices
#    Original: 1=Negative, 2=Neutral, 3=Positive, 4=Mixed
#    Mixed folded into "negative" -- no "mixed" bucket in your schema.
# ============================================================
print("Downloading ccosme/SentiTaglishProductsAndServices ...")
hf_dataset = load_dataset("ccosme/SentiTaglishProductsAndServices", split="train")

LABEL_MAP = {
    1: "negative",
    2: "neutral",
    3: "positive",
    4: "negative",  # Mixed -> negative (folded, see note above)
}

hf_examples = [
    (row["review"], LABEL_MAP[row["sentiment"]])
    for row in hf_dataset
    if row["review"] and row["review"].strip()
]
print(f"Loaded {len(hf_examples)} examples from the HF dataset.")

# ============================================================
# 3. MERGE + TRAIN
# ============================================================
TRAINING_DATA = BARANGAY_SEED_DATA + hf_examples
print(f"Total training examples: {len(TRAINING_DATA)} "
      f"({len(BARANGAY_SEED_DATA)} barangay-specific + {len(hf_examples)} from HF dataset)")

TEXTS = [t for t, _ in TRAINING_DATA]
LABELS = [l for _, l in TRAINING_DATA]

X_train, X_test, y_train, y_test = train_test_split(
    TEXTS, LABELS, test_size=0.2, random_state=42, stratify=LABELS
)

# ---- Vectorize ----
vectorizer = TfidfVectorizer(
    lowercase=True,
    ngram_range=(1, 2),
    min_df=2,
)
X_train_vec = vectorizer.fit_transform(X_train)
X_test_vec = vectorizer.transform(X_test)

# ---- Train (multinomial logistic regression -- 3-class) ----
model = LogisticRegression(max_iter=1000, class_weight="balanced")
model.fit(X_train_vec, y_train)

# ---- Evaluate ----
preds = model.predict(X_test_vec)
print(f"\nTest accuracy: {accuracy_score(y_test, preds):.2f}")
print(classification_report(y_test, preds))

# ---- Save ----
with open("vectorizer.pkl", "wb") as f:
    pickle.dump(vectorizer, f)

with open("sentiment_model.pkl", "wb") as f:
    pickle.dump(model, f)

print("\nSaved vectorizer.pkl and sentiment_model.pkl")
print("Copy both into api/ (replacing the old ones) and deploy.")
print(f"Model classes: {list(model.classes_)}")

# ---- Quick manual test ----
samples = [
    "Salamat po sa tulong niyo, sobrang laking bagay!",
    "Bobo kayo, wala kayong ginagawa!",
    "Ano po ang schedule ng susunod na meeting?",
    "Sayang lang ang budget dito, wala namang naitulong.",
]
sample_vec = vectorizer.transform(samples)
sample_preds = model.predict(sample_vec)
sample_probas = model.predict_proba(sample_vec)
print("\nSample predictions:")
for text, pred, proba in zip(samples, sample_preds, sample_probas):
    class_index = list(model.classes_).index(pred)
    score = proba[class_index]
    print(f"  [{pred:<9} {score:.2f}] {text}")