
document.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector('[data-printable-page="true"]')) {
    return;
  }

  if (!window.simpleDatatables || !window.simpleDatatables.DataTable) {
    return;
  }

  const tables = Array.from(document.querySelectorAll("table"));
  const searchable_tables = Array.from(document.querySelectorAll(".searchable-staff-table"));

  searchable_tables.forEach((table) => {
    if (table.dataset.datatableInitialized === "true") {
      return;
    }

    new window.simpleDatatables.DataTable(table, {
      tableRender: (_data, table, type) => {
        if (type === "print") {
          return table
        }
        const tHead = table.childNodes[0]
        const filterHeaders = {
          nodeName: "TR",
          attributes: {
            class: "search-filtering-row"
          },
          childNodes: tHead.childNodes[0].childNodes.map(
            (_th, index) => ({
              nodeName: "TH",
              childNodes: [
                {
                  nodeName: "INPUT",
                  attributes: {
                    class: "datatable-input",
                    type: "search",
                    "data-columns": "[" + index + "]"
                  }
                }
              ]
            })
          )
        }
        tHead.childNodes.push(filterHeaders)
        return table
      },
      searchable: true,
      sortable: true,
      paging: true,
      perPage: 10,
      perPageSelect: [5, 10, 20, 50],
      labels: {
        placeholder: "Search...",
        perPage: "entries per page",
        noRows: "No entries found",
        info: "Showing {start} to {end} of {rows} entries"
      }
    });

    table.dataset.datatableInitialized = "true";
  });

  tables.forEach((table) => {
    if (table.dataset.datatableInitialized === "true") {
      return;
    }

    new window.simpleDatatables.DataTable(table, {
      searchable: true,
      sortable: true,
      paging: true,
      perPage: 10,
      perPageSelect: [5, 10, 20, 50],
      labels: {
        placeholder: "Search...",
        perPage: "entries per page",
        noRows: "No entries found",
        info: "Showing {start} to {end} of {rows} entries"
      }
    });

    table.dataset.datatableInitialized = "true";
  });
});