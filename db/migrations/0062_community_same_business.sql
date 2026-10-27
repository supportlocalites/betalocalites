-- =============================================================================
-- Localites — migration 0062: Community, the same business suggested by more than one person
-- =============================================================================
-- The product owner, 27 October 2026, choosing mock-up 1A: "make each comment individual" (two
-- people suggesting the same business are two answers, each with its own words and votes), with
-- how many times the business is suggested in the thread beside its name.
--
-- 0061 allowed one answer per business per question ("already suggested: vote it up instead").
-- Now each PERSON suggests a business once per question (a second from them would only inflate
-- its count); someone else may suggest it too. Shown answers only, as before, so one held for
-- the team never blocks anything.
--
-- Not destructive: two unique indexes replaced by two narrower ones; no rows change.
-- =============================================================================

set search_path = public, extensions;

drop index community_answer_one_per_business;
drop index community_answer_one_per_name;

create unique index community_answer_person_once_per_business on community_answer (question_id, author_user_id, vendor_id)
  where vendor_id is not null and status = 'shown';
create unique index community_answer_person_once_per_name on community_answer (question_id, author_user_id, lower(business_name))
  where business_name is not null and status = 'shown';
