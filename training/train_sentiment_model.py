"""
train_sentiment_model.py

Trains the TF-IDF + Logistic Regression sentiment classifier used by
should_flag_comment() / is_comment_negative() in api/index.py.

This version merges two sources of training data:
  1. Your original hand-written barangay-specific examples (BARANGAY_SEED_DATA
     below) -- small, but anchored to your actual domain (SK officials,
     budget reports, programs for kabataan).
  2. ccosme/SentiTaglishProductsAndServices, a free, CC-BY-4.0 licensed,
     10,510-row Taglish dataset manually labeled by 3 human annotators
     (Fleiss' kappa 0.82 / Krippendorff's alpha 0.83 -- strong agreement).
     https://huggingface.co/datasets/ccosme/SentiTaglishProductsAndServices
     It's product/service reviews, not civic comments, but it's the same
     Taglish code-switching style and gives the model far more vocabulary
     and phrasing than 120 examples alone ever could.

Run this locally (NOT on Vercel):
    pip install scikit-learn datasets pandas
    python train_sentiment_model.py

Produces two files:
    vectorizer.pkl
    sentiment_model.pkl

Copy BOTH into your api/ folder (replacing the old ones) and deploy
alongside index.py. Nothing else changes -- should_flag_comment() just
loads whatever .pkl files are sitting next to it.

The downloaded dataset itself (via load_dataset(), cached by Hugging Face
under ~/.cache/huggingface) never needs to be committed to your repo or
deployed -- it's a training-time ingredient only.
"""

import pickle
from datasets import load_dataset
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score

# ============================================================
# 1. YOUR BARANGAY-SPECIFIC SEED DATA (kept from the original script)
#    label: 0 = positive/neutral (not flagged), 1 = negative/toxic (flagged)
# ============================================================
BARANGAY_SEED_DATA = [
    # ---- Positive / neutral (0) ----
    ("Salamat po sa inyong serbisyo, malaking tulong po ito sa amin.", 0),
    ("Ang galing ng proyektong ito, sana po magpatuloy.", 0),
    ("Maraming salamat sa mga SK officials sa pagtulong sa aming barangay.", 0),
    ("Napakaganda ng inisyatibo na ito para sa kabataan.", 0),
    ("Sana po magkaroon pa ng ganitong programa sa susunod na taon.", 0),
    ("Nakakatuwa naman itong proyekto, keep it up!", 0),
    ("Very helpful po ang document na ito, thank you.", 0),
    ("Good job sa mga SK officials, transparent talaga kayo.", 0),
    ("Ang linaw po ng report, madaling maintindihan.", 0),
    ("Sobrang laking tulong nito sa aming mga magulang.", 0),
    ("Panalo ang programang ito para sa mga kabataan.", 0),
    ("Grabe ang dami niyong natulungan, proud ako sa inyo.", 0),
    ("Very informative po, salamat sa pag-post nito.", 0),
    ("Sana lahat ng barangay ganito ka-transparent.", 0),
    ("Nice initiative, mas lalo pa sana kayong gumaling.", 0),
    ("Ito yung dapat gawin ng lahat ng SK, salute!", 0),
    ("Malinaw po ang budget report, thank you sa transparency.", 0),
    ("Kudos sa pamunuan, epektibo ang programa ninyo.", 0),
    ("Salamat sa update, alam namin kung saan napupunta ang budget.", 0),
    ("Napakalaking tulong nito sa kabataan ng barangay namin.", 0),
    ("Sana magpatuloy pa ang mga ganitong proyekto.", 0),
    ("Astig, dapat talaga ma-implement ito agad.", 0),
    ("Well done sa taong nag-organize nito.", 0),
    ("Ang bait niyo talaga, thank you sa serbisyo.", 0),
    ("Solid ang report, walang mali dito.", 0),
    ("Congrats sa successful event kahapon.", 0),
    ("Please continue po ang ganitong klaseng transparency.", 0),
    ("Sulit ang budget na ginamit, maayos ang implementation.", 0),
    ("Thank you po sa pagbibigay ng detalyadong impormasyon.", 0),
    ("Ang husay talaga ng mga kabataang lider dito.", 0),
    ("Kailan po ang susunod na event? Sasali kami ulit.", 0),
    ("Pwede po ba malaman kung saan gagamitin ang budget na ito?", 0),
    ("Ano po ang requirements para makasali sa programang ito?", 0),
    ("Saan po pwede kumuha ng registration form?", 0),
    ("Magandang umaga po, gusto ko lang po itanong ang schedule.", 0),
    ("Puwede po malaman ang venue ng susunod na aktibidad?", 0),

    # ---- Negative / toxic (1) ----
    ("Wala kayong ginagawa, puro pangako lang.", 1),
    ("Sayang lang ang budget dito, walang kwenta ito.", 1),
    ("Bobo talaga ang mga opisyal dito, wala silang naiintindihan.", 1),
    ("Kadiring proyekto ito, puro sipsip lang kayo sa mayor.", 1),
    ("Wala kwentang serbisyo, ang bagal niyo pa magrespond.", 1),
    ("Panay kayo daldal, walang aksyon.", 1),
    ("Ang panget ng ginawa niyo, sayang ang pera ng bayan.", 1),
    ("Puro kalokohan itong mga proyektong ito.", 1),
    ("Gago talaga itong mga opisyal, wala kayong silbi.", 1),
    ("Nakakainis kayo, sabi niyo tulong pero wala namang natulungan.", 1),
    ("Kawawa naman kami, pinapabayaan lang ng SK.", 1),
    ("Ang tanga tanga ng plano niyo, di kayo marunong mag-isip.", 1),
    ("Puro sipsip lang kayo, walang kwentang lider.", 1),
    ("Nakaka-inis kayo, puro salita walang gawa.", 1),
    ("Sino ba pumayag dito, ang pangit ng idea.", 1),
    ("Kayo lang naman ang nakikinabang dito, mga corrupt.", 1),
    ("Bulok ang serbisyo niyo, wala kayong ginagawa para sa amin.", 1),
    ("Ayaw ko sa ginagawa niyo, sayang lang ang oras namin.", 1),
    ("Grabe ang katangahan ng mga desisyon niyo dito.", 1),
    ("Puro kayo pakitang tao, wala namang tunay na tulong.", 1),
    ("Wala kang alam, huwag ka nang mag-post ng ganyan.", 1),
    ("Sobrang cheap ng ginawa niyo, nakakahiya.", 1),
    ("Puro daya itong proseso niyo, hindi fair sa amin.", 1),
    ("Yuck, ang panget talaga ng plano niyo dito.", 1),
    ("Corrupt kayo, alam naming pinagkakakitaan niyo ito.", 1),
    ("Wala kayong pakialam sa amin, puro sarili niyo lang inisip.", 1),
    ("Hindi ko matanggap ang katangahan ng ginawa niyo.", 1),
    ("Sayang ang tax namin dito, walang resulta.", 1),
    ("Puro kasinungalingan ang laman ng report na ito.", 1),
    ("Nakakadiri ang atityud niyo sa mga residente.", 1),
    ("Walang silbi itong mga SK officials, tanggalin niyo na sila.", 1),
    ("Puro palusot, wala kayong tino.", 1),
    ("Nagagalit ako sa kapabayaan niyong ipinapakita.", 1),
    ("Grabe ka-duwag, ayaw sagutin ang mga tanong namin.", 1),
    ("Tuta lang kayo ng mga politiko, wala kayong sariling pananaw.", 1),
    ("Bobo", 1),
    ("Tanga", 1),
]

# ============================================================
# 2. DOWNLOAD + REMAP: ccosme/SentiTaglishProductsAndServices
#    Original label encoding: 1=Negative, 2=Neutral, 3=Positive, 4=Mixed
#    Remapped to your binary scheme:
#      Negative, Mixed        -> 1 (flagged)
#      Neutral,  Positive     -> 0 (not flagged)
# ============================================================
print("Downloading ccosme/SentiTaglishProductsAndServices ...")
hf_dataset = load_dataset("ccosme/SentiTaglishProductsAndServices", split="train")

LABEL_MAP = {
    1: 1,  # Negative -> flagged
    2: 0,  # Neutral  -> not flagged
    3: 0,  # Positive -> not flagged
    4: 1,  # Mixed    -> flagged (contains negative content worth reviewing)
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
    ngram_range=(1, 2),   # unigrams + bigrams help catch short phrases like "walang kwenta"
    min_df=2,             # a term must appear in >=2 docs now that the corpus is much bigger
)
X_train_vec = vectorizer.fit_transform(X_train)
X_test_vec = vectorizer.transform(X_test)

# ---- Train ----
model = LogisticRegression(max_iter=1000, class_weight="balanced")
model.fit(X_train_vec, y_train)

# ---- Evaluate ----
preds = model.predict(X_test_vec)
print(f"\nTest accuracy: {accuracy_score(y_test, preds):.2f}")
print(classification_report(y_test, preds, target_names=["not_flagged", "flagged"]))

# ---- Save ----
with open("vectorizer.pkl", "wb") as f:
    pickle.dump(vectorizer, f)

with open("sentiment_model.pkl", "wb") as f:
    pickle.dump(model, f)

print("\nSaved vectorizer.pkl and sentiment_model.pkl")
print("Copy both into api/ (replacing the old ones) and deploy.")

# ---- Quick manual test, including your original barangay-context samples ----
samples = [
    "Salamat po sa tulong niyo, sobrang laking bagay!",
    "Bobo kayo, wala kayong ginagawa!",
    "Ano po ang schedule ng susunod na meeting?",
    "Sayang lang ang budget dito, wala namang naitulong.",
]
sample_vec = vectorizer.transform(samples)
sample_preds = model.predict(sample_vec)
print("\nSample predictions:")
for text, pred in zip(samples, sample_preds):
    label = "FLAGGED (negative)" if pred == 1 else "not flagged"
    print(f"  [{label}] {text}")