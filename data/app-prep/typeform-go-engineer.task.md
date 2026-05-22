# Coding Interview

The goal of this task is to assess your problem-solving skills, coding ability, and understanding of basic web application development principles in a live coding session. You will build a simplified version of Typeform's builder and renderer.

**Task Description:**

Create a web application that allows users to build simple forms and collect responses. The application should meet the following core requirements:

**Form Builder Functionality:**

There's no need for authentication.

1. **Create New Forms:** Users should be able to initiate the creation of a new form.
2. **Add Questions:** Within a form, users must be able to add questions.
3. **Save Forms:** Users should be able to save a form. Saving should only be possible if the form contains at least one question.
4. **Generate Shareable URL:** Upon successfully saving a form, the application must generate a **unique and shareable URL** for that specific form.
5. **View All Forms:** There should be a dedicated section or page where users can see a list of all the forms they have created.

**Form Renderer Functionality:**

1. **Access via URL:** When someone navigates to a form's shareable URL, they should be presented with the form interface.
2. **One-by-One Questions:** The form should display questions to the respondent, one question at a time.
3. **Collect Answers:** The application must capture the answers provided by the respondent and store them.
4. **Thank You Screen:** After the respondent answers the final question, they should be shown a simple "Thank You" message or screen.

**Technical Requirements:**

1. **Database:** You are free to choose any database technology. Be prepared to explain your choice.
2. **Simplicity:** Focus on implementing the core features cleanly and simply. Avoid over-engineering. Basic UI/UX is sufficient.
3. **Libraries/Frameworks:** You can use any programming languages, frameworks, or libraries you are comfortable with for both the backend and frontend.

**AI Usage:**

- We **encourage** the use of AI tools (ChatGPT, Claude Code, Cursor, Windsurf, Cline, Aider…).
- We should be able to see your prompts.

---

[View the original task (gist)](https://gist.github.com/miquelarranz/5d54a4701e420f64045c343b6cfb6dc3) — the gist also includes reference screenshots that aren't part of `task.md`.
