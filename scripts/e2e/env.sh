# Settings for the local sign-in test server (sourced by CI and by hand). Throwaway values:
# this server only ever runs on this computer, for tests.
export GOTRUE_API_HOST=127.0.0.1
export PORT=9999
export API_EXTERNAL_URL=http://127.0.0.1:9999
export GOTRUE_DB_DRIVER=postgres
export GOTRUE_DB_NAMESPACE=auth
export DATABASE_URL="${E2E_AUTH_DATABASE_URL:?set E2E_AUTH_DATABASE_URL}"
export GOTRUE_SITE_URL=http://localhost:4173
export GOTRUE_JWT_SECRET="${E2E_AUTH_JWT_SECRET:?set E2E_AUTH_JWT_SECRET}"
export GOTRUE_JWT_EXP=3600
export GOTRUE_JWT_AUD=authenticated
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
export GOTRUE_JWT_ADMIN_ROLES=service_role
# As the live project will be set (PO-13): new accounts allowed, email addresses confirmed
# by the emailed code, 6-digit codes that last 15 minutes.
export GOTRUE_DISABLE_SIGNUP=false
export GOTRUE_MAILER_AUTOCONFIRM=false
export GOTRUE_MAILER_OTP_EXP=900
export GOTRUE_MAILER_OTP_LENGTH=6
# Emails go to the pretend email service (scripts/e2e/mail-server.mjs), using our template.
export GOTRUE_SMTP_HOST=127.0.0.1
export GOTRUE_SMTP_PORT=2525
export GOTRUE_SMTP_ADMIN_EMAIL=no-reply@example.test
export GOTRUE_SMTP_SENDER_NAME=Localites
export GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=http://127.0.0.1:8787/sign-in-code.html
export GOTRUE_MAILER_TEMPLATES_CONFIRMATION=http://127.0.0.1:8787/sign-in-code.html
export GOTRUE_MAILER_SUBJECTS_MAGIC_LINK='Your Localites code: {{ .Token }}'
export GOTRUE_MAILER_SUBJECTS_CONFIRMATION='Your Localites code: {{ .Token }}'
# The tests check our own limits; Supabase's per-address limits would only make them flaky.
# Supabase's wait between codes to one address is 60 seconds; 5 here keeps the tests quick.
export GOTRUE_SMTP_MAX_FREQUENCY=5s
export GOTRUE_RATE_LIMIT_EMAIL_SENT=1000
export GOTRUE_RATE_LIMIT_OTP=1000
export GOTRUE_RATE_LIMIT_VERIFY=1000
export GOTRUE_EXTERNAL_EMAIL_ENABLED=true
export GOTRUE_MFA_TOTP_ENROLL_ENABLED=true
export GOTRUE_MFA_TOTP_VERIFY_ENABLED=true
export GOTRUE_LOG_LEVEL=warn
