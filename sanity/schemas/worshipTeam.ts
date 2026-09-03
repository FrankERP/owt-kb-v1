import { defineType } from "sanity";

export const teamMembers = defineType({
  name: "teamMembers",
  title: "Team Members",
  type: "document",
  fields: [
    {
      name: "member_name",
      title: "Member Name",
      type: "string",
    },
    {
      name: "slug",
      title: "Slug",
      type: "slug",
      options: {
        source: "member_name",
        maxLength: 96,
      },
    },
    {
      name: "alias",
      title: "Alias",
      type: "string",
    },
    {
      name: "email",
      title: "Email",
      type: "string",
      description: "Must match the SSO provider email exactly (case-insensitive lookup).",
      validation: (Rule: any) => Rule.email(),
    },
    {
      name: "role",
      title: "App Role",
      type: "string",
      options: {
        list: [
          { title: "Super Admin", value: "super-admin" },
          { title: "Admin", value: "admin" },
          { title: "Content Editor", value: "content-editor" },
          { title: "Member", value: "member" },
        ],
        layout: "radio",
      },
      initialValue: "member",
    },
    {
      name: "disabled",
      title: "Acceso deshabilitado",
      type: "boolean",
      initialValue: false,
      description: "Si está activo, este miembro pierde el acceso a la app en segundos (kill switch). Reversible.",
    },
    {
      name: "ministries",
      title: "Ministerios (membresía)",
      type: "array",
      of: [{ type: "string" }],
      options: {
        list: [
          { title: "Alabanza", value: "worship" },
          { title: "Oasis Kids", value: "kids" },
        ],
      },
      description:
        "Ministerios a los que pertenece este miembro. VACÍO o ausente = solo Alabanza (comportamiento legado; NO rellenar en masa).",
    },
    {
      // `worship` is deliberately NOT offered here — worship management stays with the
      // legacy `admin`/`content-editor` roles, and no guard reads a "worship" entry in
      // this field. Offering it would create a second worship-admin path nothing honours.
      name: "managesMinistries",
      title: "Administra ministerios",
      type: "array",
      of: [{ type: "string" }],
      options: {
        list: [{ title: "Oasis Kids", value: "kids" }],
      },
      description:
        "Otorga administración del ministerio nombrado (p. ej. planear el rol de Kids). NO implica membresía ni acceso de Alabanza. Solo super-admin edita este campo.",
    },
    {
      // NO `initialValue` — deliberate, and the neighbouring prefs below all have one.
      // An unset `themePref` is the load-bearing signal Child F's staged rollout reads:
      // "this member has never chosen", as distinct from "this member chose dark". An
      // initialValue would stamp every document on creation and empty F's cohort before
      // F begins. Guarded by themePrefSchema.test.ts.
      //
      // `hidden` keeps it out of Studio's member form (invariant 13 / D11) — a theme is
      // a client preference, not something an admin sets on someone's behalf, which is
      // the same reasoning behind PATCH /api/me/theme's 403 under impersonation.
      name: "themePref",
      title: "Theme preference (member-set)",
      type: "string",
      hidden: true,
    },
    {
      name: "deviceTokens",
      title: "Device push tokens",
      type: "array",
      hidden: true,
      of: [{
        type: "object",
        fields: [
          { name: "token", type: "string" },
          { name: "platform", type: "string" },
          { name: "updatedAt", type: "datetime" },
        ],
      }],
    },
    {
      name: "notifPrefs",
      title: "Preferencias de notificaciones",
      type: "object",
      fields: [
        { name: "assignments", type: "boolean", initialValue: true },
        {
          name: "email",
          title: "Asignaciones por correo",
          type: "boolean",
          initialValue: true,
          description: "Recibir asignaciones por correo electrónico.",
        },
        {
          name: "emailAssigned",
          title: "Nuevas asignaciones por correo",
          type: "boolean",
          initialValue: true,
        },
        {
          name: "emailRemoved",
          title: "Avisos de baja por correo",
          type: "boolean",
          initialValue: true,
        },
        {
          name: "emailRoleChanged",
          title: "Cambios de rol por correo",
          type: "boolean",
          initialValue: true,
        },
        {
          name: "emailSetlist",
          title: "Setlist por correo",
          type: "boolean",
          initialValue: true,
        },
        {
          name: "emailProposals",
          title: "Propuestas por correo",
          type: "boolean",
          initialValue: true,
        },
        { name: "setlist", type: "string", initialValue: "all", options: { list: ["all", "assigned", "off"] } },
        { name: "proposals", type: "boolean", initialValue: true },
        { name: "reminders", type: "boolean", initialValue: true },
      ],
    },
    {
      name: "memberType",
      title: "Tipo",
      type: "array",
      of: [{ type: "string" }],
      options: {
        list: [
          { title: "Voz", value: "voz" },
          { title: "Instrumento", value: "instrumento" },
          { title: "FOH", value: "foh" },
          { title: "Líder Domingo", value: "sunday_lead" },
          { title: "Líder Sábado", value: "saturday_lead" },
          { title: "Soporte", value: "support" },
        ],
        layout: "grid",
      },
      description: "Determina en qué secciones puede aparecer este miembro. Combinar Voz + subtipo de liderazgo para los pools del solver.",
    },
    {
      name: "profilePhoto",
      title: "Profile Photo",
      type: "image",
      options: { hotspot: true },
    },
    {
      name: "googlePhotoUrl",
      title: "Google Photo URL",
      type: "string",
      hidden: true,
      description: "Synced from Google OAuth on each sign-in. Used as fallback when no custom photo is uploaded.",
    },
    {
      name: "lastSeen",
      title: "Last Seen",
      type: "datetime",
      hidden: true,
      description: "Updated automatically by the app when the member is active.",
    },
    {
      name: "passwordHash",
      title: "Password Hash (bcrypt)",
      type: "string",
      hidden: true,
      description: "Set via the admin password-setup API or CLI script. Never edit manually.",
    },
    {
      name: "unavailableDates",
      title: "Fechas no disponibles",
      type: "array",
      of: [{ type: "string" }],
      description: "ISO dates (YYYY-MM-DD) when this member is unavailable. Set by the member from /me.",
    },
    {
      name: "unavailabilityNotes",
      title: "Notas de no disponibilidad",
      type: "array",
      of: [{
        type: "object",
        fields: [
          { name: "date", type: "string", title: "Fecha (YYYY-MM-DD)" },
          { name: "note", type: "string", title: "Nota" },
        ],
      }],
      hidden: true,
      description: "Optional reasons per unavailable date. Set by the member from /me.",
    },
  ],
});
