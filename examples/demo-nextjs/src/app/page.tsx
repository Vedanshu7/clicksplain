export default function Home() {
  return (
    <main style={{ maxWidth: 560, margin: "64px auto", padding: "0 24px" }}>
      <h1>clicksplain + Next.js</h1>
      <p>
        Click the &ldquo;?&rdquo; button bottom-right, then click any element
        below to get an LLM-generated explanation of what it does.
      </p>

      <section style={{ marginTop: 32, display: "grid", gap: 12 }}>
        <button type="button" style={{ padding: "10px 16px" }}>
          Export report
        </button>

        <form style={{ display: "grid", gap: 8, border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" placeholder="teammate@company.com" />
          <label htmlFor="role">Role</label>
          <select id="role">
            <option>Member</option>
            <option>Admin</option>
          </select>
          <button type="submit" style={{ padding: "10px 16px" }}>
            Send invite
          </button>
        </form>
      </section>
    </main>
  );
}
