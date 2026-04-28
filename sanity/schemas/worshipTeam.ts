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
  ],
});
