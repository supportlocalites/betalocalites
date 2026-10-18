-- =============================================================================
-- Checks for migration 0038: the "suggested business is listed" email kind. Rolled back.
-- =============================================================================

begin;

insert into app_user (id, display_name, email) values ('00000000-0000-7000-8000-0000000038a1', 'Pat', 'p-38@example.com');
insert into notification (user_id, kind, subject_type, subject_id)
values ('00000000-0000-7000-8000-0000000038a1', 'suggestion_listed', 'vendor_suggestion', '00000000-0000-7000-8000-0000000038b1');
do $$ begin
  raise notice 'PASS  a "suggestion listed" email can be recorded  (1)';
end $$;
do $$ begin
  begin
    insert into notification (user_id, kind, subject_type, subject_id)
    values ('00000000-0000-7000-8000-0000000038a1', 'made_up_kind', 'vendor_suggestion', '00000000-0000-7000-8000-0000000038b1');
    raise exception 'FAIL  an unknown kind of email was accepted';
  exception when check_violation then
    raise notice 'PASS  an unknown kind of email is still refused  (23514)';
  end;
end $$;
insert into notification (user_id, kind, subject_type, subject_id)
values ('00000000-0000-7000-8000-0000000038a1', 'held_edit_published', 'vendor', '00000000-0000-7000-8000-0000000038b2');
do $$ begin
  begin
    insert into notification (user_id, kind, subject_type, subject_id)
    values ('00000000-0000-7000-8000-0000000038a1', 'suggestion_listed', 'vendor_suggestion', '00000000-0000-7000-8000-0000000038b1');
    raise exception 'FAIL  a second "suggestion listed" email for the same suggestion was accepted';
  exception when unique_violation then
    raise notice 'PASS  one "suggestion listed" email per suggestion, even sent twice at once  (23505)';
  end;
end $$;
do $$ begin
  raise notice 'PASS  the kinds added before (0036) are still allowed  (1)';
end $$;

rollback;
