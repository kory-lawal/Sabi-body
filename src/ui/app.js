export function mountApp(root) {
  if (!root) {
    throw new Error("Cannot start Sabi Body: the app root (#app) was not found.");
  }

  root.innerHTML = `
    <div class="home-page">
      <header class="site-header">
        <p class="wordmark">Sabi Body</p>
        <p class="tagline">The sabi-sabi fitness coach</p>
      </header>
      <section class="welcome" aria-labelledby="welcome-title">
        <p class="welcome__eyebrow">Your movement, your pace</p>
        <h1 id="welcome-title">Feel good in your body.</h1>
        <p class="welcome__intro">
          Find your rhythm with simple, guided workouts you can do at home.
        </p>
      </section>
      <section class="exercises" aria-labelledby="exercises-title">
        <h2 id="exercises-title">Exercises</h2>
      </section>
    </div>
  `;
}
