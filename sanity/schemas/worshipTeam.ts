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
        ],
        layout: "grid",
      },
      description: "Determina en qué secciones puede aparecer este miembro.",
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
