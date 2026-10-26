-- Retour arrière de 011 : tables de facturation, quota d'export de Tools et liste « Me prévenir » V2 supprimés (l'ancien
-- code ne les lit pas ; ytc_plan_waitlist, de 009, n'a jamais été touchée). Les abonnements et paiements eux-mêmes
-- restent chez Stripe : résilie-les AVANT tout retour arrière s'il en existe (docs/FACTURATION.md, « Retour arrière »).
DROP TABLE IF EXISTS ytc_offer_waitlist;
DROP TABLE IF EXISTS ytc_tools_export;
DROP TABLE IF EXISTS ytc_billing_consent;
DROP TABLE IF EXISTS ytc_billing_event;
DROP TABLE IF EXISTS ytc_entitlement;
DROP TABLE IF EXISTS ytc_billing_purchase;
DROP TABLE IF EXISTS ytc_billing_subscription;
DROP TABLE IF EXISTS ytc_billing_customer;
