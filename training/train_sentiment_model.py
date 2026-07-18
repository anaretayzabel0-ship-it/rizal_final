"""
train_sentiment_model.py

Trains a lightweight TF-IDF + Logistic Regression sentiment classifier
for Filipino/Taglish comments, aimed at flagging negative/toxic comments
for review by SK officials.

This is a STARTER dataset (hand-written, ~120 examples) meant to get a
working prototype live. For production-quality accuracy, replace/expand
TRAINING_DATA below with real labeled comments collected from your own
site over time -- the more real examples, the better it will generalize.

Run this locally (not on Vercel):
    pip install scikit-learn
    python train_sentiment_model.py

Produces two files:
    vectorizer.pkl
    sentiment_model.pkl
Copy both into your api/ folder and deploy alongside index.py.
"""

import pickle
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score

# ============================================================
# STARTER TRAINING DATA
# label: 0 = positive/neutral (not flagged), 1 = negative/toxic (flagged)
# ============================================================
TRAINING_DATA = [
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
]

TEXTS = [t for t, _ in TRAINING_DATA]
LABELS = [l for _, l in TRAINING_DATA]

X_train, X_test, y_train, y_test = train_test_split(
    TEXTS, LABELS, test_size=0.2, random_state=42, stratify=LABELS
)

# ---- Vectorize ----
vectorizer = TfidfVectorizer(
    lowercase=True,
    ngram_range=(1, 2),   # unigrams + bigrams help catch short phrases like "walang kwenta"
    min_df=1,
)
X_train_vec = vectorizer.fit_transform(X_train)
X_test_vec = vectorizer.transform(X_test)

# ---- Train ----
model = LogisticRegression(max_iter=1000, class_weight="balanced")
model.fit(X_train_vec, y_train)

# ---- Evaluate ----
preds = model.predict(X_test_vec)
print(f"Test accuracy: {accuracy_score(y_test, preds):.2f}")
print(classification_report(y_test, preds, target_names=["not_flagged", "flagged"]))

# ---- Save ----
with open("vectorizer.pkl", "wb") as f:
    pickle.dump(vectorizer, f)

with open("sentiment_model.pkl", "wb") as f:
    pickle.dump(model, f)

print("\nSaved vectorizer.pkl and sentiment_model.pkl")

# ---- Quick manual test ----
samples = [
    "Salamat po sa tulong niyo, sobrang laking bagay!",
    "Bobo kayo, wala kayong ginagawa!",
    "Ano po ang schedule ng susunod na meeting?",
]
sample_vec = vectorizer.transform(samples)
sample_preds = model.predict(sample_vec)
print("\nSample predictions:")
for text, pred in zip(samples, sample_preds):
    label = "FLAGGED (negative)" if pred == 1 else "not flagged"
    print(f"  [{label}] {text}")