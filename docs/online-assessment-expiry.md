# Online assessment expiry processing

Online assessment links default to seven days. Requests to the learner link, assessment library, and results manager also process overdue assessments and send any pending result emails. For expiry emails to be sent on time when nobody is using the app, schedule the CLI processor to run once per minute.

Learner answer drafts are saved while an attempt is active. The server rejects draft saves and scored submissions after the deadline, preserving the last successfully saved answers without accepting late work. Learners move between questions with the Next question button; MCQ selection does not skip ahead automatically.

Changing the availability period on a published assessment resets the link's expiry to the selected number of days from the change. For a paused assessment, that period starts when it is resumed because the paused interval is added to the expiry.

An assessment can be unpublished for question edits only before any learner has started. Unpublishing blocks learner access without publishing results; the creator can edit questions and publish it again, which starts a fresh availability period. Once an attempt exists, the assessment cannot be unpublished or edited, preserving its answer and score history. The results view groups learners into class tabs, calculates ranks within each class, and includes class names in score-sheet exports.

The assessment manager refreshes results every five seconds while it is visible. Teachers can pause or end each assigned class independently. Pausing a class blocks new attempts while existing attempts may finish; ending a class expires its active attempts, preserving their last autosaved responses. An authorized teacher or administrator can reset an individual learner's access for a retake. Retakes use a new numbered attempt; the previous answers, score and integrity events remain in the teacher's attempt history.

Student results slips can be exported individually or in class batches as PDF or Word documents. Exports include available school and administrator details, the uploaded school logo, formatted performance summaries, and color-coded question-type performance and answer feedback.

The learner page blocks copy, cut, paste and context-menu actions where the browser supports those controls. It also records detectable screenshot shortcuts, focus changes and tab hiding as browser-reported activity signals. Web pages cannot reliably prevent operating-system screenshots, external capture tools, cameras or a second device; integrity events are signals for review, not proof of misconduct.

Apply database migration `027_assessment_retake_and_class_controls.sql` before deploying these changes.

On the XAMPP Windows server, create a Task Scheduler task that runs:

- Program: `C:\xampp\php\php.exe`
- Arguments: `C:\xampp\htdocs\www\shsPlannerAi\bin\process-assessment-expirations.php`
- Trigger: repeat every 1 minute, indefinitely
- Run whether or not a user is logged in; use the account that can read the app configuration and connect to MySQL.

On Linux, an equivalent cron entry is:

```cron
* * * * * /usr/bin/php /path/to/shsPlannerAi/bin/process-assessment-expirations.php
```

The task relies on the app's configured SMTP settings. Failed result emails remain pending and are retried by the next scheduled run; the failure is logged for the administrator.
