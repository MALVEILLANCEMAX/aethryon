-- Facturation sur le site, modèle V2 (docs/FACTURATION.md) : Annuel (abonnement Stripe annuel, Checkout + Billing +
-- portail) et À vie (paiement unique Stripe Checkout, sans renouvellement). Tables vides et inutilisées tant que
-- BILLING=off (défaut) : aucun appel au prestataire, aucun droit. Aucune donnée de carte ni de paiement sensible : elles
-- restent chez Stripe. Plus le quota d'export de Tools et la liste « Me prévenir » des offres payantes. La migration
-- entière est une transaction ; elle ne supprime ni ne modifie aucune donnée existante.

-- 1. Compte ↔ client Stripe : un client par compte, un compte par client (association durable, créée côté serveur).
--    hold : droit payant suspendu par un litige en cours (levé s'il est gagné).
CREATE TABLE ytc_billing_customer (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE CHECK (length(stripe_customer_id) BETWEEN 5 AND 64),
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  hold TEXT CHECK (hold IS NULL OR hold IN ('litige', 'remboursement')),
  hold_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. Abonnements Annuel : copie de l'état RELU chez Stripe à chaque événement (l'ordre d'arrivée n'importe pas).
--    plan NULL = prix inconnu de ce serveur : jamais de droit. renewal_notice_for : échéance pour laquelle le rappel de
--    reconduction (Code de la consommation L215-1) a été envoyé, renewal_notice_at : quand. confirmed_at : confirmation
--    du contrat envoyée sur support durable (e-mail, L221-13), une fois.
CREATE TABLE ytc_billing_subscription (
  stripe_subscription_id TEXT PRIMARY KEY CHECK (length(stripe_subscription_id) BETWEEN 5 AND 64),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  plan TEXT CHECK (plan IS NULL OR plan = 'annuel'),
  status TEXT NOT NULL CHECK (length(status) BETWEEN 3 AND 32),
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0, 1)),
  current_period_start TEXT,
  current_period_end TEXT,
  canceled_at TEXT,
  renewal_notice_for TEXT,
  renewal_notice_at TEXT,
  confirmed_at TEXT,
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  created_at TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX ytc_billing_subscription_user ON ytc_billing_subscription(user_id);

-- 3. Achats uniques (À vie) : un par page de paiement PAYÉE (preuve : session Stripe relue, payment_status = paid).
--    État relu chez Stripe : refunded_amount (remboursements), dispute_status (litige). Un achat remboursé en entier ou
--    dont le litige est perdu ne donne plus de droit ; un litige en cours le suspend.
CREATE TABLE ytc_billing_purchase (
  stripe_session_id TEXT PRIMARY KEY CHECK (length(stripe_session_id) BETWEEN 5 AND 255),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  payment_intent_id TEXT UNIQUE CHECK (payment_intent_id IS NULL OR length(payment_intent_id) BETWEEN 5 AND 64),
  plan TEXT CHECK (plan IS NULL OR plan = 'vie'),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  refunded_amount INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  dispute_status TEXT CHECK (dispute_status IS NULL OR length(dispute_status) BETWEEN 3 AND 32),
  paid_at TEXT NOT NULL,
  confirmed_at TEXT,
  livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
  synced_at TEXT NOT NULL
);
CREATE INDEX ytc_billing_purchase_user ON ytc_billing_purchase(user_id);

-- 4. Droits (docs/ABONNEMENTS.md §2) : web (Stripe), discord (Premium Apps, non branché), manual (administrateur,
--    journalisé). L'offre effective d'un compte = la plus haute parmi ses droits actifs (plans.ts, effectivePlan).
--    external_id : abonnement (sub_…) pour Annuel, page de paiement (cs_…) pour À vie.
CREATE TABLE ytc_entitlement (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('annuel', 'vie')),
  source TEXT NOT NULL CHECK (source IN ('discord', 'web', 'manual')),
  external_id TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX ytc_entitlement_user ON ytc_entitlement(user_id);

-- 5. Événements de facturation reçus : un événement rejoué (Stripe peut envoyer deux fois le même) ne s'applique
--    qu'une fois. Ni contenu, ni montant, ni donnée personnelle : identifiant, type, issue.
CREATE TABLE ytc_billing_event (
  source TEXT NOT NULL CHECK (source IN ('stripe', 'discord')),
  event_id TEXT NOT NULL CHECK (length(event_id) BETWEEN 5 AND 80),
  type TEXT NOT NULL CHECK (length(type) BETWEEN 3 AND 80),
  received_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (length(outcome) BETWEEN 2 AND 40),
  PRIMARY KEY (source, event_id)
);
CREATE INDEX ytc_billing_event_received ON ytc_billing_event(received_at);

-- 6. Demande expresse de démarrage immédiat (Code de la consommation L221-25) : texte accepté (version) et date, avant
--    le paiement. En cas de rétractation, seule la part déjà fournie reste due (facturation.ts).
CREATE TABLE ytc_billing_consent (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('execution_immediate')),
  text_version TEXT NOT NULL CHECK (length(text_version) BETWEEN 3 AND 40),
  plan TEXT NOT NULL CHECK (plan IN ('annuel', 'vie')),
  created_at TEXT NOT NULL
);
CREATE INDEX ytc_billing_consent_user ON ytc_billing_consent(user_id, created_at);

-- 7. Quota d'export de Tools (plans.ts : exportMinutesDaily) : minutes pondérées par le coût mesuré, réservées à la
--    demande d'export, rendues si ytapi refuse ou rejoint un export identique déjà fait. Jour de Paris. cle : empreinte
--    de la demande (source + réglages) : la même demande, déjà comptée aujourd'hui, n'est pas refusée à la limite.
CREATE TABLE ytc_tools_export (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  day TEXT NOT NULL CHECK (length(day) = 10),
  cle TEXT NOT NULL CHECK (length(cle) = 64),
  job_id TEXT CHECK (job_id IS NULL OR length(job_id) BETWEEN 1 AND 64),
  op TEXT NOT NULL CHECK (op IN ('video', 'compress', 'gif', 'audio', 'apercu', 'echantillon')),
  minutes REAL NOT NULL CHECK (minutes >= 0 AND minutes <= 100000),
  state TEXT NOT NULL CHECK (state IN ('reserve', 'compte', 'rendu')),
  created_at TEXT NOT NULL
);
CREATE INDEX ytc_tools_export_user_day ON ytc_tools_export(user_id, day);

-- 8. « Me prévenir » à l'ouverture des offres payantes : une seule demande par compte (le modèle V2 n'a plus Plus ni
--    Pro). Les demandes de ytc_plan_waitlist (migration 009, Plus et/ou Pro) sont reprises, la table d'origine reste
--    intacte (aucune suppression).
CREATE TABLE ytc_offer_waitlist (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
INSERT INTO ytc_offer_waitlist (user_id, created_at) SELECT user_id, MIN(created_at) FROM ytc_plan_waitlist GROUP BY user_id;
