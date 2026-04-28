export const loginEvent = {
  name: "loginEvent",
  title: "Login Event",
  type: "document",
  fields: [
    {
      name: "member",
      title: "Member",
      type: "reference",
      to: [{ type: "teamMembers" }],
    },
    { name: "email",     title: "Email",     type: "string" },
    { name: "provider",  title: "Provider",  type: "string" },
    { name: "timestamp", title: "Timestamp", type: "datetime" },
  ],
  __experimental_actions: ["read", "delete"],
};
