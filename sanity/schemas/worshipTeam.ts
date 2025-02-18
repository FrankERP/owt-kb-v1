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
  ],
});
