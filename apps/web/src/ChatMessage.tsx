import React from "react";
import Markdown from "react-markdown";

// Model output is untrusted. Render text formatting without raw HTML,
// images, interactive controls or links supplied by the model.
export function ChatMessage({ content }: { content: string }) {
  return (
    <div className="message-content">
      <Markdown
        skipHtml
        allowedElements={[
          "p",
          "strong",
          "em",
          "ul",
          "ol",
          "li",
          "blockquote",
          "code",
          "pre",
          "br",
          "hr",
          "h1",
          "h2",
          "h3",
          "h4",
        ]}
        unwrapDisallowed
      >
        {content}
      </Markdown>
    </div>
  );
}
