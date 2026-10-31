SHS PLANNER APP

MASTER DEVELOPMENT PROMPT: BUILD A COMPLETE SHS PLANNER-STYLE AI TEACHING PLATFORM FOR GHANA
1. ROLE AND MISSION
Act as a senior full-stack software architect, PHP/MySQL engineer, UI/UX designer, AI integration specialist, educational technology consultant, and software security engineer.
Your task is to design and build a complete, production-oriented web application called [YOUR PLATFORM NAME], inspired by the publicly observable functionality of SHS Planner at https://www.shsplanner.com/.
The application must serve teachers in Ghanaian Senior High Schools and help them prepare lesson plans, assessments, schemes of work, online quizzes, teaching schedules, and PowerPoint presentations using AI-assisted workflows.
Study the public reference website, where accessible, to understand its major user journeys, interface hierarchy, form layouts, document-generation workflow, account features, and monetization model.
Build an original implementation with its own brand identity, interface styling, source code, database, content, and system architecture. Do not copy the reference site’s proprietary source code, logo, private APIs, exact visual assets, or protected text.
This is not a demonstration, mockup, or static frontend exercise. Deliver a functioning application in which forms submit, database operations work, AI generation is integrated, documents download correctly, users have individual accounts, permissions are enforced, and payments are verified on the server.
2. PRIMARY OBJECTIVES
The finished system must:
Provide a professional, mobile-responsive teaching assistant for Ghanaian SHS teachers.
Support curriculum-informed lesson planning for SHS Year 1, Year 2, and future year groups.
Generate editable Microsoft Word documents.
Generate examination papers, marking schemes, and tables of specification.
Create online multiple-choice quizzes that students can take on their phones.
Automatically grade objective assessments and produce gradebooks and performance reports.
Generate semester and academic-year schemes of work.
Generate classroom presentation slides in PowerPoint format.
Support teacher profiles, class rosters, school information, and saved documents.
Support free credits, paid credits, payment verification, referrals, and usage tracking.
Provide a comprehensive administrator dashboard.
Support installation as a Progressive Web App (PWA).
Use secure, maintainable, modular PHP and MySQL architecture.
Make it possible to add new subjects, curriculum versions, document templates, and AI models without rewriting the entire application.
3. REQUIRED TECHNOLOGY STACK
Use the following default stack unless a technical limitation requires a clearly justified alternative.
Backend
PHP 8.2 or later, compatible with the hosting environment.
MySQL 8 or a compatible MariaDB version.
PDO with prepared statements.
A modular MVC-style architecture with controllers, services, repositories, models, middleware, and views.
Composer for dependency management.
PHP sessions with secure cookie settings.
JSON endpoints for asynchronous operations.
Frontend
HTML5, CSS3, JavaScript, and Bootstrap 5.
Bootstrap Icons or Font Awesome.
Vanilla JavaScript or small, focused JavaScript modules.
Fetch API for AJAX requests.
Responsive layouts optimized for phones, tablets, laptops, and desktops.
Use a modern, polished interface without introducing an unnecessarily complex frontend framework.
Document generation
PhpWord for editable DOCX files.
PhpSpreadsheet only where spreadsheet exports are needed.
PhpPresentation for PPTX files, after verifying package availability and compatibility.
Dompdf where PDF export is required.
A suitable charting library for assessment analytics.
Use maintained, compatible Composer packages. Document every dependency and its installation command.
AI integration
Create a provider-independent AI service layer.
Support a configurable LLM API through environment variables.
Keep prompts, generation settings, validation rules, and output schemas separate from controllers.
Never expose API keys in frontend JavaScript or public files.
Allow alternative AI providers to be configured without rebuilding core application logic.
Hosting
Support standard Linux shared hosting and cPanel.
Keep sensitive configuration, secrets, logs, and application code outside the public web root where hosting permits.
Provide a working Apache rewrite configuration and a front controller.
Include production deployment instructions for a subdomain.
4. BRANDING AND VISUAL DESIGN
Create a premium educational technology interface.
Use an original visual identity, not a pixel-for-pixel recreation.
Design characteristics:
Clean white and warm-neutral surfaces.
A deep forest-green or navy primary color.
Restrained teal or gold accents.
Clear typography and strong visual hierarchy.
Consistent spacing and alignment.
Refined buttons, input fields, tabs, navigation, and modal dialogs.
Subtle borders and shadows.
Simple, purposeful animations.
No gradient text.
No excessive glass effects, oversized decorative elements, or toy-like illustrations.
Avoid clutter and unnecessarily large empty sections.
The interface should look credible to teachers, school administrators, and education professionals.
Build the main application around a unified workspace with the following primary navigation:
Lesson Plan
Assessment
Scheme of Work
Teaching Schedule
Presentation Slides
My Documents
Class Rosters
Account and Credits
On desktop, use an appropriate horizontal navigation or sidebar. On mobile, use compact tabs, a collapsible navigation menu, or another accessible mobile pattern.
The public landing page should include:
Header and navigation.
Hero section with a clear value proposition.
Primary call to action.
Product capability overview.
How it works.
Sample output previews.
Benefits for Ghanaian teachers.
Frequently asked questions.
Pricing or credit information.
Footer with contact, privacy, terms, and independence disclaimer.
Make the actual application the priority. Do not spend most of the development effort on a landing page while leaving the tools incomplete.
5. PUBLIC PAGES
Implement the following routes:
/ — Landing page.
/about — About the platform.
/features — Feature overview.
/samples — Sample generated documents.
/guides — Teacher guides.
/faq — Frequently asked questions.
/contact — Contact and support.
/privacy — Privacy policy.
/terms — Terms of service.
/login — Authentication.
/register — Account registration.
/forgot-access — Account recovery where appropriate.
/quiz/{token} — Public student quiz entry.
/verify-document/{token} — Optional document verification page.
Use a centralized router and consistent error handling.
6. AUTHENTICATION AND USER ACCOUNTS
Implement secure authentication.
Support:
Email-based one-time verification codes.
Optional Google OAuth sign-in.
Logout.
Session expiration and regeneration.
Rate limiting for authentication attempts.
Email verification.
Account status management.
Account deletion requests.
Passwordless authentication without requiring users to create passwords.
For one-time codes:
Generate cryptographically secure codes.
Store only a secure hash of the code.
Give each code a short expiration time.
Limit verification attempts.
Invalidate a code after successful use.
Enforce resend cooldowns.
Prevent email enumeration where practical.
Create user roles:
Super Administrator.
Administrator.
Teacher.
Student or Quiz Participant, with restricted access.
A teacher should only access their own profile, documents, rosters, credits, payments, and assessment records unless a specific sharing feature grants additional access.
Use role-based authorization on every protected backend route.
7. TEACHER PROFILE AND SCHOOL SETTINGS
Allow teachers to manage:
Full name.
Email address.
School name.
Region.
School type: mixed, boys, or girls.
Teaching subjects.
SHS year groups taught.
Default class sizes.
Default teaching resources.
School logo.
Document header and footer preferences.
Preferred academic year and semester.
Optional school-specific lesson-plan template.
Save these settings and automatically populate relevant forms.
Allow the teacher to override saved defaults for individual documents.
Validate uploaded images by MIME type, size, and image content. Store uploads outside executable public directories where possible.
8. LESSON PLAN BUILDER
Create a comprehensive lesson-plan generator.
Required inputs
SHS year.
Academic year.
Region.
School name.
School type.
Semester or term.
Subject.
Strand.
Sub-strand.
Content standard.
Learning indicator.
Week.
Topic.
Number of lessons per week.
Duration of each lesson.
Class name.
Number of students.
Class proficiency level.
Teaching and learning resources.
Special instructions.
Optional school-specific information.
Support proficiency differentiation, including needs-based support, learners working at the expected level, and advanced learners.
Allow teachers to add and remove teaching resources dynamically.
Populate subject, year, strand, sub-strand, and curriculum options from the database rather than hardcoding the entire curriculum into JavaScript.
Where a topic has multiple indicators, allow the teacher to choose the relevant indicators.
Generated lesson-plan structure
Generate a well-organized document containing, as appropriate:
School name and logo.
Subject, class, year, week, and duration.
Strand.
Sub-strand.
Content standard.
Learning indicator or indicators.
Core competencies.
Essential questions.
Measurable learning outcomes.
Prior knowledge.
Teaching and learning resources.
Relevant pedagogical approaches.
Introduction and learner engagement.
Step-by-step lesson development.
Teacher activities.
Learner activities.
Differentiated teaching strategies.
Worked examples where appropriate.
Assessment questions and marking guidance.
Lesson conclusion.
Homework or extension activity.
Teacher reflection and follow-up.
Include realistic timing for every lesson stage. The total duration must equal the configured lesson duration.
Use the relevant official curriculum terminology and the school’s chosen template.
Do not fabricate curriculum codes, standards, or learning indicators. Retrieve these from verified curriculum records where available. If the exact curriculum information is unavailable, identify it as missing and ask the teacher to supply it rather than falsely claiming official alignment.
Lesson-plan workflow
Validate all required inputs.
Show the teacher a summary of the selected curriculum information.
Submit a generation job.
Display progress and meaningful status messages.
Generate structured lesson content through the AI service.
Validate the generated structure.
Render a formatted preview.
Allow the teacher to edit the content.
Save the document.
Export an editable DOCX file.
Optionally export a PDF.
Allow regeneration of a selected section without losing the entire document.
Provide clear handling for failed generation, rate limits, invalid AI output, and timeouts.
9. ASSESSMENT BUILDER
Create an assessment generator with two modes.
Mode A: Printed assessment documents
Inputs:
SHS year.
Semester.
Academic year.
School name and logo.
Subject.
Class or classes.
Assessment title.
Topics or weeks covered.
Learning indicators.
Number of questions.
Question types.
Difficulty distribution.
Total marks.
Duration.
Instructions.
Optional question-selection preferences.
Support configurable question types:
Multiple-choice questions.
Short-answer questions.
Structured questions.
Essay questions.
Calculation questions where appropriate.
Diagram-based questions where supported.
Generate three separate documents:
Document 1: Question paper
Student-facing questions.
Instructions.
Numbering and mark allocations.
Time allowed.
School and examination details.
No answers or marking scheme.
Document 2: Marking scheme
Correct answers.
Expected responses.
Step-by-step solutions where necessary.
Mark allocation.
Alternative acceptable answers.
Scoring guidance for structured and essay responses.
Document 3: Table of specification
Topics and learning indicators.
Number of questions.
Marks allocated.
Weighting by topic.
Cognitive demand or Depth of Knowledge level.
Question references.
Total marks and coverage percentages.
All totals must reconcile mathematically.
Where essay marking requires professional judgement, provide a rubric instead of pretending subjective marking is fully objective.
Mode B: Online MCQ quiz
Provide:
Quiz title.
Subject.
SHS year.
Semester.
Class assignment.
Topics covered.
Question count.
Time limit.
Opening and closing dates.
Pass mark.
Attempts allowed.
Randomized question order.
Optional randomized answer order.
Student instructions.
Allow teachers to preview the questions before publishing the quiz.
Once published, generate a unique, unguessable quiz URL.
Create an accessible student interface that works on low-cost smartphones and slow internet connections.
10. ONLINE QUIZ AND STUDENT ASSESSMENT SYSTEM
Implement the full quiz lifecycle.
Student entry
Allow students to:
Open the teacher’s quiz link.
Enter their name and class.
Enter a teacher-configured access PIN or individual access code when required.
Read the instructions.
Begin the assessment.
Navigate between questions.
See unanswered questions.
Submit their answers.
Receive a submission confirmation.
Quiz security and reliability
Enforce opening and closing times on the server.
Enforce the time limit using server-validated timestamps.
Prevent unauthorized quiz access.
Use secure session or attempt tokens.
Prevent duplicate submissions.
Record the submission time.
Save answers periodically where appropriate.
Handle page refreshes and temporary connection failures.
Never expose correct answers in public HTML, JavaScript, or quiz API responses before the attempt is closed.
Grade answers on the server.
Validate every submission against the actual published question set.
Use database transactions for final submissions and grading.
Do not claim that browser-side controls alone prevent cheating.
Teacher gradebook
Provide:
Student name.
Class.
Quiz.
Score.
Total marks.
Percentage.
Grade.
Pass/fail status.
Submission timestamp.
Attempt status.
Allow filtering by quiz, class, date, and result.
Item analysis
Calculate:
Class average.
Highest and lowest scores.
Pass rate.
Score distribution.
Question-level correct response rate.
Incorrect response distribution.
Unanswered question rate.
Question difficulty indicators.
Distractor analysis.
Individual learner performance.
For questions with sufficient data, include a clearly explained discrimination indicator.
Support export of results to CSV and printable reports.
Do not expose one student’s detailed results to other students.
11. SCHEME OF WORK BUILDER
Build a complete semester and academic-year scheme-of-work generator.
Inputs
SHS year.
Academic year.
Semester.
Subject.
School name.
Start date.
End date.
Teaching days.
Number of periods per week.
Period duration.
Holidays.
Mid-semester examinations.
End-of-semester examinations.
Revision periods.
School-specific events.
Curriculum topics and indicators.
Weekly notes.
Generation logic
Generate a week-by-week schedule containing:
Week number.
Start date.
End date.
Strand.
Sub-strand.
Topic.
Content standard.
Learning indicators.
Teaching and learning activities.
Resources.
Assessment.
Remarks.
Calculate teaching weeks from the configured calendar.
Account for holidays and excluded dates. Do not schedule teaching activities on excluded dates unless the teacher explicitly overrides the rule.
Do not silently omit curriculum topics when the semester is too short. Flag the conflict and let the teacher revise the allocation.
Support:
Semester schemes.
Full academic-year schemes.
Automatic weekly date allocation.
Drag-and-drop reordering where practical.
Editing individual weeks.
Regeneration of selected weeks.
Preview.
Editable DOCX export.
PDF export where supported.
12. WEEKLY TEACHING SCHEDULE
Create a timetable-oriented interface for organizing weekly teaching.
Support:
Days of the week.
Lesson periods.
Subject.
Class.
Topic.
Learning indicators.
Duration.
Resources.
Lesson-plan links.
Completion status.
Allow teachers to view their schedule by day, week, or class.
Provide print-friendly views and the ability to generate a schedule from a scheme of work.
Prevent accidental duplicate entries and warn about conflicting time allocations where the teacher’s timetable makes the conflict identifiable.
13. POWERPOINT PRESENTATION GENERATOR
Allow a teacher to select a saved lesson plan or provide lesson content.
Inputs:
Lesson topic.
Class.
Subject.
Learning outcomes.
Number of slides.
Presentation style.
Audience proficiency.
Desired level of detail.
Optional school branding.
For presentation outlines, let the teacher choose SHS year and subject first, then select one or more available weekly curriculum allocations. Use the selected topics and focal areas to suggest editable outcomes, learning indicators, and teaching points. Offer clear lesson sequence, inquiry, worked-example, discussion, project, revision, and flipped-classroom templates, alongside distinct visual design themes. Use the same structured fields when editing a saved outline, and preserve the selected curriculum scope and template in the saved document.
Generate a structured presentation containing:
Title slide.
Learning outcomes.
Introduction.
Main teaching points.
Explanations.
Worked examples.
Diagrams or illustrations where useful.
Class activities.
Assessment questions.
Summary.
Homework or follow-up.
Use large, readable text, consistent slide layouts, meaningful visuals, and a professional classroom-friendly design.
Generate a real, editable 16:9 PPTX file, not a PDF renamed as PowerPoint. Build slide content from structured slide data using native editable PowerPoint shapes. Render supplied tables, charts, graphs, teaching sequences and comparisons as editable slide elements; never fabricate real-world statistics. Preserve the selected visual design theme and include clear titles, readable key points and classroom activities.
Where diagrams or images cannot be generated, use appropriate editable shapes, labeled placeholders, or properly licensed assets.
Allow teachers to preview slide outlines and edit the content before export.
14. CURRICULUM DATABASE AND CONTENT MANAGEMENT
Create a curriculum administration module.
Recommended entities:
Curriculum versions.
Academic years.
SHS year groups.
Subjects.
Strands.
Sub-strands.
Content standards.
Learning indicators.
Core competencies.
Topics.
Curriculum references.
Source documents.
Effective dates.
Allow authorized administrators to:
Create and edit curriculum records.
Import supported CSV files.
Validate imported data.
Detect duplicates.
Track source and version information.
Mark records as verified or unverified.
Maintain historical curriculum versions.
Do not hardcode a small list of subjects and present it as the complete Ghanaian SHS curriculum.
Provide an import workflow for official curriculum documents and structured data. Respect copyright and licensing conditions for imported materials.
15. CLASS ROSTERS
Allow teachers to create and manage classes.
A class should contain:
Class name.
SHS year.
Subject.
Academic year.
Semester.
Optional learner list.
Optional class code.
Support:
Add, edit, archive, and delete classes.
Add students manually.
Import student lists through CSV.
Validate duplicates.
Assign classes to quizzes.
View assessment results by class.
Use minimal student information and protect student data.
A class roster should not be publicly accessible.
16. MY DOCUMENTS WORKSPACE
Create a centralized document library.
Display:
Document title.
Document type.
Subject.
Class.
SHS year.
Topic or assessment title.
Creation date.
Last modified date.
Generation status.
Download options.
Support:
Search.
Filtering.
Sorting.
Pagination.
Document previews.
Editing.
Duplication.
Renaming.
Downloading.
Archiving.
Deletion with confirmation.
Regeneration.
Use background jobs or a queue for longer generation operations where hosting permits.
For shared hosting without a persistent worker, implement a reliable database-backed job processor that can run through scheduled cron tasks or controlled request processing.
Store the generated source content and export files securely. Use expiring, authorized download links where appropriate.
17. AI GENERATION ARCHITECTURE
Build a reusable AI generation engine instead of embedding API calls in individual pages.
Create services such as:
AIProviderInterface
LessonPlanService
AssessmentService
QuizGenerationService
SchemeOfWorkService
PresentationService
CurriculumValidationService
DocumentExportService
Each service should:
Validate user input.
Retrieve relevant curriculum records.
Construct a task-specific prompt.
Call the configured AI provider.
Validate the response against a defined schema.
Check consistency and completeness.
Repair or retry invalid output within configured limits.
Save the generated result.
Produce the relevant downloadable document.
Return a clear status to the frontend.
Require structured JSON responses for document sections where appropriate. Validate the response before rendering it.
Treat user-provided instructions as untrusted content. Prevent them from overriding system-level safety rules, leaking secrets, or changing authorization.
Educational quality requirements
Generated content should:
Match the selected subject and topic.
Use age-appropriate language.
Have measurable learning outcomes.
Align lesson activities with the selected indicators.
Include realistic timing.
Include appropriate differentiation.
Match assessment questions to stated outcomes.
Provide accurate worked solutions when possible.
Use Ghanaian examples when relevant.
Avoid fabricated citations and curriculum codes.
Clearly flag uncertainty.
Do not state that AI-generated content is guaranteed to be accurate.
Provide a teacher-review warning before final use.
Curriculum-grounded generation
Use retrieved curriculum information as the authoritative basis for curriculum claims.
If a required official source is missing, indicate the limitation and request clarification.
Never fabricate official GES or NaCCA approval.
18. CREDITS, SUBSCRIPTIONS, AND USAGE
Implement a configurable credit-based monetization system.
The administrator must control:
Free signup credits.
Credit cost for each document type.
Credit package prices.
Discounts.
Promotional offers.
Referral rewards.
Maximum generation attempts.
Daily usage limits.
Feature access by account type.
Example configuration:
Lesson plan: 1 credit.
Assessment package: configurable number of credits.
Scheme of work: configurable number of credits.
PowerPoint presentation: configurable number of credits.
Online quiz: configurable number of credits.
These are example defaults, not fixed business rules.
Credit ledger
Create an immutable transaction ledger with:
User.
Transaction type.
Credits added or deducted.
Related document or payment.
Unique reference.
Timestamp.
Status.
Description.
Support purchase, signup bonus, promotional bonus, referral reward, generation deduction, refund, and administrative adjustment.
Use database transactions to prevent race conditions and duplicate deductions.
Deduct credits only after a document is successfully generated and saved.
If generation fails, refund the reserved credits automatically and record the refund in the ledger.
For long-running jobs, reserve credits before generation and finalize or release the reservation according to the job result.
Never allow a user to generate unlimited paid documents by repeating requests or manipulating browser values.
19. PAYMENTS AND MOBILE MONEY
Integrate Paystack or another supported payment provider through its official server-side API.
Support:
Mobile Money where available.
Card payments where available.
Credit packages.
Payment initiation.
Payment status.
Verified transaction references.
Receipts.
Payment history.
The backend must verify every payment using the provider’s verification API or authenticated webhook.
Never add credits based solely on a browser redirect, query parameter, or JavaScript success message.
Implement:
Idempotent payment processing.
Webhook signature verification.
Duplicate-event protection.
Currency validation.
Expected-amount validation.
Transaction-reference validation.
Failed-payment handling.
Pending-payment handling.
Audit logging.
Use GH₵ as a configurable display currency and ensure the actual payment currency matches the gateway configuration.
Keep payment secrets in environment variables.
Build the credit purchase interface with quantity controls, package shortcuts, transparent pricing, and a clear payment confirmation flow.
20. REFERRAL SYSTEM
Implement a teacher referral program.
Each teacher receives a unique referral code or URL.
Record:
Referring user.
Referred user.
Signup timestamp.
Eligibility status.
Reward status.
Reward transaction.
Qualification timestamp.
Award referral credits only after the configured qualifying event occurs.
Prevent self-referrals, duplicate rewards, repeated claims, and trivial account creation intended to exploit the system.
Make referral rewards configurable in the administration panel.
21. ADMINISTRATOR DASHBOARD
Create a complete admin workspace.
Dashboard metrics
Registered users.
Active teachers.
New signups.
Documents generated.
Documents generated by type.
Successful and failed generation jobs.
Credits purchased.
Credits consumed.
Revenue.
Failed and pending payments.
Active quizzes.
Student quiz submissions.
Referral activity.
User management
Search and filter users.
View account activity.
Suspend and reactivate accounts.
Adjust credits with a mandatory reason.
Review generation history.
View payment records.
Assign appropriate roles.
Process account deletion requests.
Curriculum management
Manage subjects and curriculum versions.
Import curriculum data.
Review unverified records.
Maintain source documentation.
Platform configuration
Brand name and logo.
Contact details.
AI provider configuration status.
Credit pricing.
Payment configuration status.
Free-credit rules.
Referral settings.
Usage limits.
Document templates.
Academic-year defaults.
Maintenance mode.
Reports
Daily, weekly, and monthly usage.
Revenue reports.
Credit reconciliation.
Generation success rates.
Most-used subjects and tools.
Assessment performance summaries.
Log sensitive administrator actions in an audit trail.
22. DATABASE DESIGN
Design a normalized MySQL database using InnoDB, appropriate foreign keys, indexes, unique constraints, and consistent timestamps.
Include, at minimum, tables corresponding to:
users
user_profiles
roles
user_roles
schools
teacher_preferences
curriculum_versions
academic_years
subjects
strands
sub_strands
content_standards
learning_indicators
curriculum_sources
classes
class_students
lesson_plans
assessments
assessment_questions
assessment_options
marking_schemes
tables_of_specification
quizzes
quiz_questions
quiz_options
quiz_attempts
quiz_responses
quiz_results
schemes_of_work
scheme_weeks
teaching_schedules
presentations
documents
generation_jobs
credit_accounts
credit_transactions
credit_reservations
payment_transactions
payment_webhook_events
referrals
email_verification_codes
notifications
support_tickets
app_settings
audit_logs
Adjust the exact schema where necessary to avoid redundant data.
Use separate tables for questions, options, responses, and results when this improves data integrity.
Important constraints:
Store monetary amounts using integer minor units or an appropriately precise decimal type.
Store credit quantities using an exact numeric type.
Add unique constraints to payment references and other idempotency keys.
Add indexes to frequently filtered fields.
Enforce user ownership in database queries.
Use transactions for operations that modify several related records.
Use UTC timestamps internally and display dates in the appropriate local timezone.
Store the academic calendar and curriculum version explicitly.
Provide complete SQL migration files and a database seed script containing realistic sample data clearly identified as sample data.
23. SECURITY REQUIREMENTS
Implement production-appropriate security.
PDO prepared statements.
CSRF protection on state-changing requests.
Output escaping to prevent cross-site scripting.
Strict session cookie settings.
Session regeneration after authentication.
Server-side role and ownership checks.
Login and API rate limiting.
Secure one-time-code handling.
File upload validation.
Protected file downloads.
Secure password or token hashing where applicable.
Payment webhook verification.
Secrets outside the public web root.
Error logging without exposing stack traces to users.
Input validation on both frontend and backend.
Protection against mass assignment.
Database transaction handling.
Secure production error configuration.
Restrictive HTTP security headers.
Backup and recovery instructions.
Audit logging for sensitive actions.
Use HTTPS in production.
Never place API keys, database passwords, or payment secrets in public JavaScript, Git repositories, or downloadable configuration files.
Do not log student answers or personal information unnecessarily.
24. PROGRESSIVE WEB APP
Make the application installable on supported devices.
Provide:
Web app manifest.
Application icons.
Appropriate theme color.
Service worker.
Install instructions.
Responsive mobile navigation.
Offline caching for safe static assets.
Clear offline and connection-error states.
Do not cache authentication responses, private student results, sensitive documents, or payment information in a shared service-worker cache.
Allow safe form recovery where practical, but require server validation before accepting generated content or assessment submissions.
25. USER EXPERIENCE AND ACCESSIBILITY
Every major operation must have a clear state:
Idle.
Loading.
Success.
Failure.
Empty results.
Validation errors.
Permission denied.
Session expired.
Implement:
Field-level validation.
Clear inline error messages.
Confirmation before destructive actions.
Accessible labels and keyboard navigation.
Adequate contrast.
Responsive tables.
Search, sorting, and pagination.
Toast notifications where appropriate.
Skeleton loading states or progress indicators.
Useful empty states with relevant calls to action.
Avoid unnecessary page reloads for common operations.
For lengthy AI tasks, display a real generation status obtained from the backend. Do not simulate completion with a timer.
26. PERFORMANCE AND SCALABILITY
The application should remain responsive with thousands of teachers and documents.
Implement:
Server-side pagination.
Indexed database queries.
Efficient filtering.
Lazy loading where appropriate.
Background processing for expensive tasks.
Bounded AI request retries.
API timeouts.
Caching for public curriculum metadata.
Database connection reuse within requests.
File size limits.
Appropriate retention policies.
Error monitoring.
Avoid loading all documents, users, students, or assessment results into the browser at once.
Use asynchronous generation and polling where appropriate, with safe handling of duplicate requests.
27. DOCUMENT EXPORT QUALITY
The Word documents must be professionally formatted and genuinely editable.
Support:
Consistent fonts and margins.
Headings and page breaks.
Tables with appropriate column widths.
School logos.
Page numbering where appropriate.
Headers and footers.
Readable question numbering.
Mark allocations.
Tables of specification.
Separate teacher and student documents.
Printable layouts.
Do not export unformatted AI JSON directly to users.
Validate generated document structure before creating downloadable files.
Use unique filenames and secure storage paths.
For every document type, provide a sample output for testing.
28. PROJECT STRUCTURE
Use a maintainable structure similar to:
/app
/Controllers
/Middleware
/Models
/Repositories
/Services
/Validators
/Policies
/config
application configuration
database configuration
service configuration
/database
/migrations
/seeders
/resources
/views
/prompts
/templates
/assets
/routes
web routes
API routes
/storage
generated documents
private uploads
application logs
temporary files
/public
index.php
.htaccess
public assets
PWA manifest
service worker
/tests
unit tests
integration tests
security tests
Include Composer configuration, environment examples, and installation documentation.
The actual application structure may differ if justified, but keep responsibilities clearly separated.
29. IMPLEMENTATION PHASES
Develop the application in the following order.
Phase 1: Foundation
Inspect the hosting requirements.
Create the project structure.
Configure Composer and environment variables.
Implement the router and database layer.
Create migrations and seed data.
Implement logging and error handling.
Build the responsive application shell.
Phase 2: Accounts and profiles
Implement email-code authentication.
Add optional Google sign-in.
Build teacher profiles and preferences.
Add role-based access control.
Phase 3: Curriculum
Build the curriculum database.
Implement subject and topic selectors.
Create curriculum import and validation.
Support verified curriculum references.
Phase 4: Lesson plans
Build the complete lesson-plan form.
Implement AI generation.
Add preview and editing.
Implement DOCX export.
Add document storage and history.
Phase 5: Assessments
Build the assessment form.
Generate examination papers.
Generate marking schemes.
Generate tables of specification.
Add editing and export workflows.
Phase 6: Online quizzes
Implement quiz publishing.
Build the student interface.
Add secure submissions and automatic grading.
Implement gradebooks and item analysis.
Phase 7: Schemes and schedules
Implement academic calendar configuration.
Generate schemes of work.
Add weekly schedules and editing.
Implement export.
Phase 8: PowerPoint
Generate slide outlines.
Implement editing and preview.
Generate editable PPTX files.
Phase 9: Credits and payments
Implement credit accounting.
Add payment initiation and verification.
Add webhook handling.
Implement refunds and referral rewards.
Phase 10: Administration
Build management dashboards.
Implement reports and audit logs.
Add configurable platform settings.
Phase 11: Production hardening
Add PWA functionality.
Run security and integration tests.
Optimize database queries.
Test mobile layouts.
Verify document exports.
Prepare cPanel deployment instructions.
Conduct end-to-end acceptance testing.
Do not stop after generating the schema, homepage, or frontend components. Complete each phase and connect it to the preceding modules.
30. TESTING AND ACCEPTANCE CRITERIA
The application is not complete until the following tests pass.
Authentication
A new user can register and verify an email.
An expired code is rejected.
An invalid code is rejected.
A user cannot access another user’s private documents.
Suspended users cannot perform restricted operations.
Lesson plans
A teacher can select valid curriculum records.
A lesson plan can be generated, reviewed, edited, saved, and downloaded.
The exported DOCX opens in compatible office software.
Lesson timing adds up correctly.
Failed generation does not consume credits permanently.
Assessments
The question paper contains no answer key.
The marking scheme includes appropriate answers and allocations.
The table of specification reconciles with the actual assessment.
All exports are separate and valid files.
Online quizzes
A published quiz has a working shareable URL.
Students cannot access answers before submission.
Quiz closing times are enforced server-side.
Duplicate submissions are prevented.
Scores are calculated correctly.
Teachers can filter and export results.
Students cannot view other learners’ results.
Schemes and presentations
Academic dates and holidays are respected.
Teachers can edit generated weekly allocations.
DOCX and PPTX files open correctly.
The system reports insufficient calendar time rather than silently omitting topics.
Credits and payments
Failed generation results in a credit refund.
A successful verified payment adds the correct credits.
Replayed payment webhooks do not duplicate credits.
Forged browser payment-success parameters do not add credits.
Concurrent generation requests cannot overdraw an account.
Security and deployment
CSRF protection works.
SQL injection tests fail safely.
Private files cannot be downloaded without authorization.
Environment secrets are not publicly accessible.
The application works over HTTPS on a cPanel-hosted subdomain.
31. DELIVERABLES
Provide:
A complete working source-code project.
All PHP files, templates, JavaScript, and CSS.
Database migrations and seed files.
Composer configuration and dependencies.
AI prompt templates.
Document-generation services.
Authentication and authorization.
Credit and payment services.
Teacher and administrator interfaces.
Online quiz and grading functionality.
Sample DOCX, PDF, and PPTX outputs.
Automated tests.
.env.example containing placeholders only.
A detailed README.
Local installation instructions.
cPanel deployment instructions.
Cron configuration where required.
Database backup and restoration instructions.
A security checklist.
A list of external services and the credentials needed to activate them.
If you cannot access an external API or credential, implement its integration interface and clearly identify what must be configured. Do not falsely claim that an unavailable service is working.
32. DEVELOPMENT RULES
Write complete, runnable code rather than pseudocode.
Do not replace required functionality with placeholder buttons.
Do not leave critical workflows as TODO comments.
Do not invent successful API responses.
Do not hardcode secrets.
Do not hardcode curriculum records as if they were official.
Do not skip error handling.
Do not bypass authorization for convenience.
Do not use fake payment verification.
Do not claim tests passed without running them.
Keep controllers thin and business logic in services.
Use reusable components and consistent naming.
Preserve database integrity.
Explain architectural decisions briefly.
Include the exact file paths for every created or modified file.
If working in an existing repository, inspect it before modifying files and preserve existing conventions where practical.
If a tool or environment cannot support a feature, explain the limitation and provide the closest production-appropriate implementation.
After each phase, report the implemented features, files created, migrations applied, tests executed, failures found, and the next required step.
33. FINAL PRODUCT STANDARD
The finished platform must be a genuinely usable AI teaching assistant for Ghanaian SHS teachers, with a professional interface, verified curriculum data where available, reliable document generation, working online quizzes, accurate credit accounting, secure payment handling, and an administrator workspace.
Prioritize correctness, maintainability, data security, curriculum integrity, and usability over superficial visual similarity.
Begin by inspecting the reference website’s publicly accessible pages, defining the architecture and database schema, and producing a phased implementation plan. Then begin implementation with Phase 1 and continue until the acceptance criteria are satisfied.


