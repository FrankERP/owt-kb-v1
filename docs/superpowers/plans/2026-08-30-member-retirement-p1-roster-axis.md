# Spec: eje de retiro por ministerio (P1)

## Status

`DRAFT` — hijo 1 de 2 de `2026-08-30-member-retirement-roadmap.md`.
**Riesgo CRÍTICO.** No por tamaño: R7 crea una ruta de escritura nueva sobre `disabled`, el
campo que `isMemberActive` lee para permitir o negar **toda** petición. La escalera nombra
"auth/security/ACL boundary" como crítico y una ruta que escribe el gate de acceso está dentro,
aunque el campo y su lector ya existan. Se clasificó primero como estándar; eso era un error.
Dos `APPROVED` consecutivos sobre bytes idénticos.

## Original request

> Cómo manejaríamos lo del reference si quiero eliminar un miembro?
> Podríamos "deshabilitar" a los miembros en vez de borrarlos para mantener los datos históricos también?
>
> sí, levanta el spec del retiro suave
> Quiero conservar una forma de revocar el acceso de forma "rápida"

## Outcome

- **Primary outcome:** un miembro sale de las rotaciones de un ministerio conservando íntegro
  su historial, sin que eso toque su acceso a la app; y el kill switch de acceso se vuelve
  operable desde la app, visiblemente separado del retiro.
- **Intended user or operator:** administradores de worship y de kids; super-admin para el
  kill switch.
- **Problem and current behavior:** las dos salidas que existen hoy son la equivocada y la
  imposible. `teamMembers.disabled` revoca el acceso pero **no saca a nadie de ningún roster**:
  de 23 lecturas de `teamMembers` en `app/**`, una sola lo lee, y es la caché de auth. Un
  miembro deshabilitado sigue apareciendo en los pools del planner, en el dropdown de Persona
  de las reglas del solver y en las audiencias de correo. Borrar el documento sí lo saca de
  todo, pero destruye la identidad que el historial referencia — y falla, porque las cinco
  sedes de los role docs son referencias fuertes.
- **Success measure:** retirar a un miembro de worship lo saca de las enumeraciones de worship
  y de ninguna otra cosa: sigue apareciendo con su nombre en cada servicio pasado donde sirvió,
  sigue en kids si aplica, y su acceso a la app no cambia de estado.

## Evidence

| Fact | Source | Planning implication |
|---|---|---|
| `disabled`: `boolean`, `initialValue: false`, "kill switch. Reversible" | `sanity/schemas/worshipTeam.ts:50-54` | El eje de acceso ya existe. Este spec no lo redefine; le da UI. |
| `isMemberActive` = doc existe && `disabled !== true`; caché TTL 30 s | `app/utils/memberAccess.ts:53-77` | La latencia del "rápido" ya está medida. El retiro NO debe entrar a esta ruta ni a su caché. |
| Una sola de 23 lecturas de `teamMembers` menciona `disabled` | `grep '_type == "teamMembers"' app/** ` | Cuantifica el gap: `disabled` no es hoy un mecanismo de roster. |
| Las lecturas se parten en **enumeración** (`*[_type=="teamMembers" && <filtro>]`) y **resolución** (`_id in $ids`, `_id == $id`) | Inventario abajo | Regla central del spec. Filtrar una resolución rompería el historial y los correos de gente ya asignada. |
| `WORSHIP_AUDIENCE_GROQ_FILTER` / `WORSHIP_MEMBER_GROQ_FILTER`; el arm `!defined` "no es belt-and-braces: es el contrato de almacenamiento" | `app/ministries.ts:64-77` | El filtro nuevo debe componerse con estos, y escribir su arm de ausencia explícito por la misma razón. |
| `validateMinistryWrite` rechaza `ministries` vacío | `app/ministries.ts:100-109` | "Retirado de todo" no puede expresarse vaciando `ministries`. Necesita campo propio. |
| `normalizeMinistries`: ausente ⇒ `["worship"]` | `app/ministries.ts:41-44` | El campo nuevo debe seguir la misma regla libre de migración: ausente ⇒ sirve. |
| `kidsPair.active`: "Las parejas retiradas conservan su historial pero salen de todas las rotaciones" | `sanity/schemas/kidsPair.ts:43-48` | Precedente del patrón en este repo, con la semántica exacta buscada. |
| `draftGatingCoverage.test.ts`: escaneo invertido de `app/**`, exime por excepción; su encabezado documenta que "una frase en CLAUDE.md y N call sites correctos es un estado, no un mecanismo", y que la primera versión encontró una violación real preexistente | `app/utils/__tests__/draftGatingCoverage.test.ts:1-45` | Mecanismo probado y su modo de falla conocido: un filtro guardado en string e inyectado en otro lado es invisible a un escaneo de grupo. El guard de R2 debe cubrir esa forma. |
| Las cinco sedes de role docs son `reference` sin `weak: true` | `sanity/schemas/sunRole.ts:51,65,93,118,129` | El historial resuelve por referencia, no por copia de nombre: retirar no puede romperlo, y borrar ya está bloqueado. |
| El planner obtiene miembros de `GET /api/admin/members` | `app/components/admin/serviceSourceState.ts:141`, `AvailabilityPanel.tsx:69`, `AdminPanel.tsx:716` | **UNA sola lista alimenta selección Y resolución.** Por eso el filtro NO puede vivir en la API: ver la fila siguiente. |
| `buildSolveRequest` mapea los ids de los pools con `memberIdToName`, que **cae al id crudo** si el miembro no está en la lista; y `resolvedNameOrRaw` reinyecta a todo nombrado-por-regla ausente de los pools en `extraSupport` | `app/components/admin/plannerModel.ts:554-557, 566-568, 641-645, 648-661` | Filtrar la lista en la API no saca a un retirado del solve request: su id se vuelve una "persona" llamada `gJgJ2wc44ylNYNyNTYYu5k`, asignable; y si tiene regla, vuelve a `support` bajo su nombre crudo. Origen de R10 y razón de que R2 se aplique en el punto de uso. |
| `unresolvedRuleNames` sólo inspecciona nombres de reglas, nunca ids de pool | `app/components/admin/ruleEnforcement.ts:225-249` | El fallo anterior sería **silencioso**: ningún reporte existente lo vería. |
| `PATCH` y `DELETE` de miembro son ambos **super-admin-only**; la pestaña Miembros es `roles: ["super-admin"]` | `app/api/admin/members/[id]/route.ts:19-22`, `:113-116`; `app/components/admin/AdminPanel.tsx:567` | Retirar con rol `admin` sería un ensanchamiento de ACL, no una alineación. Fija el actor en super-admin. |
| `ADMIN_RECIPIENTS_QUERY` selecciona por rol y **no tiene filtro de ministerio alguno** | `app/utils/proposalNotifyQueries.ts:34` | Componerle un filtro de retiro de worship le impone una semántica de ministerio que nunca tuvo. Ver preguntas abiertas. |
| `AdminPanel` no tiene ningún control de `disabled` | `grep disabled app/components/admin/AdminPanel.tsx` | R7 es UI nueva sobre campo existente: sin esquema nuevo, sin lector nuevo. |

### Inventario de las lecturas de `teamMembers` en `app/**`

**Enumeración — filtran en la SELECCIÓN** (el ministerio indicado es el del filtro).
**La primera fila es la excepción y hay que leerla antes que el resto:** su consulta NO lleva el
filtro de retiro, porque la lista que devuelve alimenta también la resolución. Implementar desde
el encabezado sin leer la fila rompería la resolución de ids de pool — exactamente el fallo
contra el que este spec dedica un párrafo.

| Lectura | Ministerio | Por qué |
|---|---|---|
| `app/api/admin/members/route.ts:23` | worship | **NO se filtra por retiro en la consulta.** Devuelve lo mismo que hoy — ya acotado por `WORSHIP_MEMBER_GROQ_FILTER` con `$all`, así que "todos" sólo es cierto para un super-admin — más el campo `retiredFrom`. El planner filtra en el punto de selección. Filtrar el retiro aquí rompería la resolución id→nombre de los pools (ver R10). |
| `app/(client)/kids/admin/page.tsx` | kids | Roster de kids |
| `app/api/kids/members/route.ts` | kids | Roster de kids |
| `app/api/kids/generate/route.ts` | kids | Candidatos del generador de kids |
| `app/utils/serviceMutationSideEffects.ts:840` | worship | Audiencia de correo de setlist |
| `app/utils/proposalNotifyQueries.ts` (`role in ["super-admin","admin"]`) | worship | Audiencia de propuestas |

**Resolución — NUNCA filtran** (`_id in $ids` / `_id == $id`): `app/(client)/me/page.tsx`,
`app/api/me/route.ts`, `app/api/me/availability/route.ts`, `app/api/me/password/route.ts`,
`app/api/kids/members/[id]/availability/route.ts`, `app/api/kids/pairs/pairMembers.ts`,
`app/utils/assignmentEmail.ts` (×2), `app/utils/memberAccess.ts`, `app/utils/outboxSweep.ts`,
`app/utils/proposalNotify.ts`, `app/utils/proposalNotifyQueries.ts` (lead por id),
`app/utils/push.ts`, `app/utils/serviceReadQueries.ts`.

**Enumeración exenta, con razón declarada:**

| Lectura | Por qué se exime |
|---|---|
| `app/api/admin/login-events/route.ts:20` | Vista de auditoría de accesos. Ocultar a un retirado escondería precisamente el evento que interesa: que alguien fuera del roster entró. |
| `app/utils/outboxLiveness.ts` | Audiencia de **operador**, no roster: alerta a super-admins de que el outbox está atorado. Depende del rol, no de servir. |
| `app/ministries.ts:50` | Comentario de uso, no consulta ejecutable. |

## Requirements

**Este spec es la fuente única del texto normativo de los requisitos que posee.** El roadmap
padre los mapea por id y por una etiqueta estable, y deliberadamente no copia este texto: la
duplicación entre artefactos es la clase de defecto que dos rondas de revisión encontraron.
Los ids son únicos en toda la familia; `R8`, `R9`, `R12` y `R13` pertenecen a P2 y no aparecen
aquí.

| ID | Requirement | Rationale | Acceptance criterion |
|---|---|---|---|
| R1 | El retiro se almacena por ministerio, y la **ausencia del campo significa que sirve** | Decisión D1 del roadmap; contrato libre de migración que este repo ya usa en `published` y `ministries` | Los 57 documentos existentes, sin tocarlos, se leen como "sirve en todos sus ministerios" |
| R2 | La **selección** — quién puede ser elegido o enumerado — excluye a los retirados del ministerio correspondiente | Es el gap que hace que `disabled` no sirva como retiro | Un guard automatizado falla si una selección nueva omite el filtro |
| R2b | Las enumeraciones **exentas** llevan razón escrita y el guard las conoce | Sin esto el guard exigiría filtrar `outboxLiveness`, silenciando la alarma de outbox atorado justo para un super-admin retirado | Las exenciones declaradas son CUATRO — las tres del inventario más `GET /api/admin/members`, que deliberadamente no filtra en la consulta porque su lista sirve también a la resolución — y el guard falla si aparece una quinta sin declarar |
| R3 | La **resolución** nunca filtra: `_id in $ids`, `_id == $id`, id→nombre de pool, ocupante histórico | Filtrarlas rompería el historial y los correos de gente ya asignada | Un retirado sigue resolviendo con nombre y foto en cada servicio pasado |
| R10 | Un retirado deja de ser **asignable por el solver** aunque su id siga en un pool, y una regla que lo nombre no lo reinyecta | R2 por sí solo no lo logra: `memberIdToName` cae al id crudo y `resolvedNameOrRaw` reinyecta en `extraSupport`, produciendo un id crudo asignable en silencio | El solve request no contiene ni el id ni el nombre del retirado en ningún pool; y el planner **dice** cuántos retirados hay en los pools, en vez de callarlo |
| R4 | `disabled` conserva significado, latencia y conjunto de lectores exactos | El usuario pidió explícitamente conservar el revocado rápido | Ninguna ruta nueva lee ni escribe `disabled` junto al retiro; `memberAccess.ts` sin cambios |
| R5 | Retirar no modifica ningún documento de **servicio** | Decisión D2: no reescribir lo que el equipo ya vio. R15 sí escribe el `solverConfig`, que no es un documento de servicio | Las mutaciones tocan el doc del miembro y, cuando R15 aplica, el `solverConfig`; jamás un role doc |
| R6 | Un ocupante retirado en un servicio **futuro** se señala en el planner | Contraparte obligada de R5: no tocar exige avisar | La sede muestra el aviso; el servicio no cambia solo |
| R7 | El kill switch es operable desde la app, en un control visiblemente distinto del retiro | El "rápido" pedido hoy pasa por Studio | Un super-admin revoca acceso sin salir de la app; los dos controles no se confunden |
| R14 | El control de kill switch **rechaza** deshabilitar la sesión que actúa, y rechaza deshabilitar al último super-admin habilitado | `auth.ts:52` y `:79` rechazan el login de un deshabilitado, y el control nuevo vive tras una pestaña y una ruta super-admin-only. Sin R14, R7 introduce un bloqueo de la superficie de administración que sólo se deshace con credenciales de Sanity, fuera de la app. Hoy no existe porque `disabled` sólo se escribe desde Studio: quien lo apaga ya está del otro lado de la puerta | Los dos intentos se rechazan con mensaje propio, no con el genérico. **Y la comprobación no puede ser sólo previa:** dos super-admins deshabilitándose mutuamente en paralelo pasan cada uno la comprobación "¿queda otro habilitado?" y ambas escrituras aterrizan, dejando cero — el resultado exacto que R14 existe para impedir. Es el gemelo de R12 en P2 y necesita la misma clase de respuesta |
| R15 | Retirar **resuelve las reglas del solver que nombran al retirado**, y no puede borrar en silencio una regla que involucra a alguien más | Sacar a un retirado de los pools mientras `dsl_rules` lo nombra revienta el solve del mes: `known` se arma sólo con los pools y `require_person` lanza `ValueError` (`gcf/owt_solver_v2.py:466-467`, `:279-280`). Y una regla **conjunta** protege también al otro: borrarla le cambia la programación a alguien que no se retiró | Los tres casos se comportan distinto: (a) restricción que nombra **sólo** al retirado → se borra con el retiro; (b) presencia con **3 o más** personas → se le quita al retirado y la regla sobrevive; (c) conflicto, o presencia con **exactamente dos** → la regla no puede sobrevivir: la UI lista qué reglas morirían **y a quién más afectan**, y el retiro no procede sin confirmación explícita |
| R11 | El boundary de escritura rechaza un retiro incoherente | Mismo estándar que `validateMinistryWrite` | Retirar de un ministerio al que el miembro no pertenece se rechaza con mensaje, no se normaliza en silencio |

## Scope

### In scope

- Campo nuevo en `sanity/schemas/worshipTeam.ts` y su despliegue de esquema.
- Helper de filtro GROQ compartido, junto a `WORSHIP_AUDIENCE_GROQ_FILTER` en `app/ministries.ts`.
- Aplicación del filtro a las seis enumeraciones listadas.
- Guard de cobertura automatizado, al estilo de `draftGatingCoverage.test.ts`.
- Validación de escritura, junto a `validateMinistryWrite`.
- UI en `AdminPanel`: control de retiro por ministerio y toggle de `disabled`, separados.
- Aviso en el planner para ocupante retirado en servicio futuro.
- Documentación: invariante en `CLAUDE.md`, y ADR si la revisión lo pide.

### Non-goals

- Migrar las reglas del solver de nombre a id (decidido en D4 del roadmap, entregado aparte).
- Arreglar la regla `5cbxwcm` que nombra `"Vale Sosa"` — es un dato, no código.
- Migrar los pools del `solverConfig` a un almacenamiento con integridad referencial. R10
  convive con los ids-string tal como están; cambiarlos es el trabajo de D4 del roadmap.
- Endurecer `DELETE` ni limpiar ids colgantes del `solverConfig` — eso es P2.
- Tocar `unavailableDates` / `unavailabilityNotes`: la indisponibilidad es temporal, por fechas
  y declarada por el propio miembro; el retiro es indefinido, sin fechas y administrativo.
- Retirar automáticamente a quien lleve N meses sin servir.
- Cambiar `kidsPair.active`.

## Behavior and invariants

- **Required behavior:** retirar de un ministerio saca al miembro de la **selección** de ese
  ministerio y de ninguna otra, y lo saca del solve request aunque su id siga almacenado en un
  pool. Reversible sin pérdida.
- **Dónde vive el filtro:** en el punto de **uso**, no en la consulta. `GET /api/admin/members`
  sigue devolviendo a todos, ahora con `retiredFrom`; el planner filtra al ofrecer candidatos,
  al poblar el dropdown de Persona y al construir los pools del solve request, y **no** filtra
  al resolver un id de pool o un ocupante histórico a un nombre. Poner el filtro en la consulta
  es la variante que parece más limpia y es la que rompe: deja al planner sin la mitad de los
  datos que necesita para resolver.
- **Preserved behavior:** `disabled` (kill switch, TTL 30 s). El contrato `ministries` ausente
  ⇒ worship. El rechazo de `ministries` vacío. El aislamiento de ministerios en dos direcciones.
- **Data invariants:** ausencia ⇒ sirve. El campo sólo contiene ids de ministerio conocidos.
  Nunca se usa para expresar acceso.
- **Security invariants:** el retiro **no** concede ni revoca acceso. Un retirado con
  `disabled: false` sigue entrando y viendo su propio perfil e historial — deliberado: irse del
  equipo no debe borrar tu historial de tu propia vista.
- **Failure and recovery:** el retiro es una escritura de un campo sobre un documento. Falla
  → nada cambia. Revertir el código deja el campo sin lectores, con el sistema comportándose
  como hoy.

## Dependencies and constraints

- Despliegue de esquema a Sanity (`sanity:deploy-schema`) antes de que la UI escriba el campo.
- **R15 y R10 se ordenan entre sí, y el orden es parte del requisito:** primero se resuelven las
  reglas, después se excluye del request. Invertirlo es exactamente el 422. Y como R15 escribe
  el `solverConfig` mientras el retiro escribe el doc del miembro, el retiro deja de ser una
  sola escritura: el plan de implementación debe decir qué pasa si una aterriza y la otra no, y
  cuál va primero para que el estado parcial sea seguro.
- R10 toca `buildSolveRequest`, que es el constructor del request del solver. No cambia el
  solver ni el contrato del endpoint: cambia qué nombres se le mandan. Un plan de
  implementación debe pinear que un pool sin retirados produce un request byte-idéntico al de
  hoy, o el riesgo deja de estar acotado.
- El guard de R2 debe cubrir el modo de falla ya documentado en `draftGatingCoverage.test.ts`:
  un filtro guardado en una constante e inyectado en otro archivo es invisible a un escaneo de
  grupo. Ese escaneo encontró una violación real preexistente sólo cuando se le añadió la
  comprobación de predicado suelto.
- Escrituras a Sanity de producción requieren consentimiento explícito (CLAUDE.md). Este spec
  no autoriza ninguna.

## Decisions

| Decision | Choice | Why | Tradeoffs | Owner |
|---|---|---|---|---|
| Forma del campo | `retiredFrom: MinistryId[]` | Ausente ⇒ sirve. "Retirado de todo" es representable sin vaciar `ministries`, que el boundary rechaza. Un booleano no puede expresar D1. | Un array donde D1-global habría permitido un booleano. Consecuencia directa de la elección del usuario. | P1 |
| Semántica del filtro | `!defined(retiredFrom) || !("<min>" in retiredFrom)` para las consultas que sí filtran; el predicado equivalente en TypeScript para el punto de uso | Arm de ausencia explícito, por la misma razón que `app/ministries.ts:64` lo escribe: es el contrato, no defensa. | Más verboso que confiar en la semántica de `in` sobre `undefined`. | P1 |
| Actor del retiro | Super-admin-only | `PATCH` y `DELETE` de miembro ya lo son y la pestaña Miembros también. Cualquier otra cosa es ensanchar la ACL, que tiene su propio precio y nadie lo pidió. | Un super-admin en el camino de cada retiro, incluidos los de kids. | Frank |
| Enforcement de R10 | Test unitario fijo, **no** un guard de escaneo — y se decide, no se omite | El precedente que este spec invoca (`draftGatingCoverage.test.ts`) es un escaneo de grupos GROQ; R10 vive en un punto de uso de TypeScript en `plannerModel.ts`, estructuralmente invisible a esa forma. Escribirlo aquí evita que quede "N call sites correctos, que es un estado, no un mecanismo" por omisión en vez de por decisión. | R10 queda protegido por tests de un solo sitio; si `buildSolveRequest` se reescribe o se duplica, nada lo fuerza. Aceptado: hay UN constructor de request y el test vive junto a él. | P1 |
| Ids de pool de un retirado | **Se conservan almacenados** y se excluyen al construir el solve request | Borrarlos del `solverConfig` haría que des-retirar no restaure la pertenencia al pool: el retiro dejaría de ser reversible sin pérdida, que es un invariante de este spec. Excluirlos en el request logra lo mismo sin escribir nada. Es seguro **sólo porque R15 ya eliminó las reglas que lo nombraban**: sin eso, un pool sin él más un `dsl_rules` con él es el 422. | El `solverConfig` conserva ids de gente retirada; es estado recuperable y el planner lo reporta. | P1 |
| Reglas que nombran a un retirado | Se borran al retirar; **con confirmación** si involucran a alguien más | Elección de Frank. No es normalización silenciosa — lo que este spec prohíbe — porque el borrado es explícito, se enseña antes, y en el caso conjunto se confirma nombrando a quién más afecta. | **El borrado de reglas NO se deshace al des-retirar.** El retiro es reversible; sus reglas no vuelven. La UI debe decirlo antes de confirmar, no después. | Frank |
| Escritura incoherente | Se rechaza, no se normaliza | Normalizar en silencio es cómo `"Vale Sosa"` sobrevivió invisible. | Un error más que manejar en la UI. | P1 |
| `disabled` intacto | Sí | Petición explícita del usuario. | Dos controles en pantalla en vez de uno. Es el punto. | Frank |

## Assumptions

| Assumption | Impact if false | Validation | Failure response |
|---|---|---|---|
| El inventario de 23 lecturas está completo y bien clasificado | Filtrar de más rompe historial; de menos deja el gap | Reejecutar el grep como primer paso de implementación; el guard lo vuelve continuo | Reclasificar y ajustar el guard antes de tocar código |
| Las cuatro exenciones son correctas — las tres del inventario más `GET /api/admin/members`, que no filtra en la consulta porque su lista sirve también a la resolución | Un retirado recibiría alertas de operador, o un evento de acceso quedaría oculto | Revisión adversarial de este spec | Convertir la exención en filtro; el guard las lista explícitamente |
| Nadie depende hoy de que un deshabilitado siga en los pools | El filtro cambiaría comportamiento esperado | Ninguna: `disabled` no se filtra hoy, así que este spec no altera ese caso | — |

## Open questions

| Question | Why it matters | Recommendation and why | Tradeoffs | Owner | Blocking? | Resolution point | Bounded default |
|---|---|---|---|---|---|---|---|
| ¿Retirar de todos los ministerios sugiere revocar acceso? | Es el único punto donde los dos ejes se tocan | **Sugerir, nunca automatizar.** Automatizar reintroduce el acoplamiento que motivó separarlos | Un paso manual en el caso más común | Frank | No | Diseño de UI | Sugerencia, no automatismo |
| ¿Un ministry manager de kids puede retirar de kids? | D1 hizo el retiro por ministerio, pero el actor sigue siendo de rol, y el CLAUDE.md dice que el rol nunca implica ministerio | **No en P1.** Abrirlo es un ensanchamiento de ACL con su propio precio; sin evidencia de que la operación sea frecuente, no se paga por adelantado | Un super-admin en el camino de cada retiro de kids | Frank | No | Después de P1, si duele | Super-admin-only |
| ¿La audiencia de propuestas debe filtrar retiro de worship? | `ADMIN_RECIPIENTS_QUERY` selecciona por ROL y no tiene filtro de ministerio alguno hoy (`proposalNotifyQueries.ts:34`); componerle uno de worship le impone una semántica que nunca tuvo | **Filtrar, y declarar el efecto sobre un admin sólo-kids**, que hoy recibe estos correos y dejaría de recibirlos — correcto, pero debe ser deliberado y no un efecto colateral | Si un admin gestiona worship sin servir en worship, deja de enterarse | Frank | No | Implementación | Filtrar, y anotar el cambio |

## Acceptance and verification

| Requirement | Acceptance evidence | Verification method |
|---|---|---|
| R1 | Un doc sin el campo se lee como "sirve" en ambos ministerios | Test unitario del normalizador, con un doc sin el campo |
| R2 | Los puntos de selección excluyen a los retirados | Guard de cobertura sobre `app/**`, invertido; falla al añadir una selección sin filtro |
| R2b | Las cuatro exenciones están declaradas y una quinta falla el guard | Test del guard con una enumeración exenta no declarada |
| R3 | Un retirado resuelve con nombre en un servicio pasado, y su id de pool resuelve a su nombre | Test de integración sobre `serviceReadQueries`; test de `memberIdToName` con un miembro retirado presente en la lista |
| R10 | El solve request no contiene el id crudo ni el nombre del retirado en ningún pool. **Alcanzable sólo con R15 cumplido**: sin borrar antes las reglas que lo nombran, este criterio produce el `ValueError` del solver, no un mes bien resuelto | Test de `buildSolveRequest` con un retirado en un pool y sin reglas que lo nombren; más un test de que "retirado con regla viva" es inalcanzable porque R15 lo impide antes |
| R4 | `memberAccess.ts` sin cambios; ninguna ruta nueva toca `disabled` junto al retiro | Diff vacío en ese archivo + escaneo del guard |
| R5 | Ningún documento de **servicio** cambia al retirar | Test de que las mutaciones del handler tocan sólo el doc del miembro y, cuando R15 aplica, el `solverConfig` — jamás un role doc |
| R6 | El aviso aparece; el servicio no cambia | Test de componente del planner con un ocupante retirado |
| R7 | Un super-admin revoca acceso desde la app | Test de componente + verificación visual |
| R11 | El retiro incoherente se rechaza con mensaje | Test unitario del validador, junto a los de `validateMinistryWrite` |
| R15 | Los tres casos se comportan distinto, y el (c) no procede sin confirmación | Un test por caso; y un test de que el retiro con regla conjunta **sin** confirmación no escribe nada, ni al miembro ni al `solverConfig` |
| R14 | Auto-deshabilitarse y deshabilitar al último super-admin habilitado se rechazan, y dos deshabilitaciones simultáneas no pueden dejar cero | Tres tests de la ruta: sesión actuante como objetivo; objetivo siendo el único super-admin con `disabled != true`; y dos escrituras concurrentes que individualmente pasan la comprobación |

## Terminal state

`READY_FOR_ADVERSARIAL_REVIEW` — las tres preguntas abiertas son no bloqueantes y tienen
default acotado. Riesgo **crítico**: dos `APPROVED` consecutivos sobre bytes idénticos.
